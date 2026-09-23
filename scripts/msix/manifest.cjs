"use strict";

// The OUTARCH MSIX package manifest (AppxManifest.xml), generated from
// packaging/msix/store.config.json and package.json.
//
// Kept apart from the build driver so the rules the Store checks at upload
// (identity, version shape, capabilities) are covered by node:test.

// Placeholders shipped in store.config.json. A Store build refuses them: the
// Identity must match the one Partner Center reserved for the app exactly, or
// the upload is rejected.
const PLACEHOLDER_IDENTITY_NAME = "OUTARCH.Desktop.Placeholder";
const PLACEHOLDER_PUBLISHER = "CN=00000000-0000-0000-0000-000000000000";

// The publisher of a local test build (npm run package:msix:test). Windows
// never installs an unsigned package that contains a desktop executable, so a
// test build is either registered unpacked in Developer Mode
// (scripts/msix/install-test.ps1) or signed with a self-signed certificate
// whose subject is this name. The Store refuses it.
const TEST_PUBLISHER = "CN=OUTARCH Local Test";

const ARCHITECTURES = Object.freeze(["x64", "arm64"]);

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/** 2.19.0 -> 2.19.0.0. The Store reserves the fourth part and requires it to be 0. */
function msixVersion(version) {
  const match = SEMVER.exec(String(version || ""));
  if (!match) throw new Error(`package.json version "${version}" is not major.minor.patch`);
  const parts = match.slice(1, 4).map(Number);
  if (parts.some(part => part > 65535)) throw new Error(`version ${version} has a part above 65535, which MSIX cannot carry`);
  if (parts[0] === 0) throw new Error("the Store needs a major version of 1 or more");
  return `${parts.join(".")}.0`;
}

function xml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const WINDOWS_VERSION = /^10\.0\.\d{5}\.\d+$/;

/**
 * Check store.config.json. `strict` (a Store build) also refuses the
 * placeholders, which only a local test build may carry.
 */
function validateStoreConfig(config, { strict = true } = {}) {
  const problems = [];
  const text = (key, max) => {
    const value = config?.[key];
    if (typeof value !== "string" || !value.trim()) problems.push(`${key} is required`);
    else if (value.length > max) problems.push(`${key} is longer than ${max} characters`);
  };
  text("identityName", 50);
  text("publisher", 8192);
  text("publisherDisplayName", 256);
  text("displayName", 256);
  text("description", 2048);
  text("applicationId", 64);
  if (typeof config?.identityName === "string" && !/^[A-Za-z0-9.-]{3,50}$/.test(config.identityName)) {
    problems.push("identityName may only hold letters, digits, dots and hyphens (3 to 50)");
  }
  if (typeof config?.publisher === "string" && !/^CN=/.test(config.publisher)) {
    problems.push('publisher must be the distinguished name Partner Center shows, starting "CN="');
  }
  if (typeof config?.applicationId === "string" && !/^[A-Za-z][A-Za-z0-9.]{0,63}$/.test(config.applicationId)) {
    problems.push("applicationId must start with a letter and hold only letters, digits and dots");
  }
  if (!WINDOWS_VERSION.test(String(config?.minVersion || ""))) problems.push("minVersion must look like 10.0.19041.0");
  if (!WINDOWS_VERSION.test(String(config?.maxVersionTested || ""))) problems.push("maxVersionTested must look like 10.0.26100.0");
  const protocols = config?.protocols ?? [];
  if (!Array.isArray(protocols) || protocols.some(name => !/^[a-z][a-z0-9.+-]{1,38}$/.test(String(name)))) {
    problems.push("protocols must be lowercase URI scheme names");
  }
  if (strict) {
    if (config?.identityName === PLACEHOLDER_IDENTITY_NAME) problems.push("identityName is still the placeholder: copy Package/Identity/Name from Partner Center > Product identity");
    if (config?.publisher === PLACEHOLDER_PUBLISHER) problems.push("publisher is still the placeholder: copy Package/Identity/Publisher from Partner Center > Product identity");
    if (config?.publisher === TEST_PUBLISHER) problems.push("publisher is the local test publisher, which the Store refuses");
  }
  return problems;
}

/**
 * The manifest for one architecture.
 *
 * OUTARCH is a full-trust desktop app (Electron). Two declarations matter
 * beyond the usual ones:
 *   - runFullTrust: the Win32 app runs as it does outside the package.
 *   - unvirtualizedResources with file-system and registry write virtualization
 *     disabled: OUTARCH writes other tools' settings on purpose (the MCP setup
 *     edits %APPDATA%\Claude\claude_desktop_config.json) and its terminals run
 *     the operator's own tools (npm, git, agents), which write to %APPDATA%
 *     and HKCU. Under default MSIX virtualization those writes would land in a
 *     private per-package copy that no other program can see. Both are
 *     restricted capabilities: the Partner Center submission must explain them
 *     (see MICROSOFT_STORE.md).
 */
function buildAppxManifest({ config, version, architecture, publisher = config.publisher }) {
  if (!ARCHITECTURES.includes(architecture)) throw new Error(`unsupported architecture ${architecture}`);
  const executable = `${config.executableName || "OUTARCH"}.exe`;
  const protocols = (config.protocols || []).map(name => `        <uap3:Extension Category="windows.protocol">
          <uap3:Protocol Name="${xml(name)}" Parameters="&quot;%1&quot;">
            <uap:DisplayName>${xml(config.displayName)}</uap:DisplayName>
          </uap3:Protocol>
        </uap3:Extension>`).join("\n");
  const extensions = protocols ? `
      <Extensions>
${protocols}
      </Extensions>` : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
  xmlns:desktop6="http://schemas.microsoft.com/appx/manifest/desktop/windows10/6"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap3 desktop6 rescap">
  <Identity
    Name="${xml(config.identityName)}"
    Publisher="${xml(publisher)}"
    Version="${xml(msixVersion(version))}"
    ProcessorArchitecture="${architecture}" />
  <Properties>
    <DisplayName>${xml(config.displayName)}</DisplayName>
    <PublisherDisplayName>${xml(config.publisherDisplayName)}</PublisherDisplayName>
    <Description>${xml(config.description)}</Description>
    <Logo>Assets\\StoreLogo.png</Logo>
    <desktop6:FileSystemWriteVirtualization>disabled</desktop6:FileSystemWriteVirtualization>
    <desktop6:RegistryWriteVirtualization>disabled</desktop6:RegistryWriteVirtualization>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="${xml(config.minVersion)}" MaxVersionTested="${xml(config.maxVersionTested)}" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="${xml(config.applicationId)}" Executable="${xml(executable)}" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="${xml(config.displayName)}"
        Description="${xml(config.shortDescription || config.displayName)}"
        BackgroundColor="${xml(config.backgroundColor || "transparent")}"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile
          ShortName="${xml(config.displayName)}"
          Wide310x150Logo="Assets\\Wide310x150Logo.png"
          Square71x71Logo="Assets\\Square71x71Logo.png"
          Square310x310Logo="Assets\\Square310x310Logo.png" />
      </uap:VisualElements>${extensions}
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="unvirtualizedResources" />
  </Capabilities>
</Package>
`;
}

module.exports = {
  ARCHITECTURES,
  PLACEHOLDER_IDENTITY_NAME,
  PLACEHOLDER_PUBLISHER,
  TEST_PUBLISHER,
  buildAppxManifest,
  msixVersion,
  validateStoreConfig,
  xml
};
