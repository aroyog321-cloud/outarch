"use strict";

// Builds the OUTARCH Bridge VS Code extension package (.vsix).
//
//   node scripts/package-vsix.cjs            build integrations/vscode/outarch-bridge-<version>.vsix
//   node scripts/package-vsix.cjs --install  build, then install it with the `code` command
//
// A .vsix is a zip with a fixed layout. It is written here with Node's zlib
// rather than PowerShell's Compress-Archive: Windows PowerShell 5.1 stores
// entry names with backslashes, and VS Code then cannot find
// extension/package.json inside the package, so the old packages would not
// install. The manifest is generated from package.json, so the name, version,
// icon and description can never disagree with the extension itself.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync, execSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const extensionDir = path.join(root, "integrations", "vscode");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "package.json"), "utf8"));

// Files that ship inside the package, relative to integrations/vscode.
const FILES = ["package.json", "extension.cjs", "bridgeModel.cjs", "README.md", "CHANGELOG.md", "LICENSE.md", manifest.icon.replace(/^\.\//, "")];

function xml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function vsixManifest() {
  const tags = (manifest.keywords || []).join(",");
  const kinds = (manifest.extensionKind || ["workspace"]).join(",");
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(manifest.name)}" Version="${xml(manifest.version)}" Publisher="${xml(manifest.publisher)}" />
    <DisplayName>${xml(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(manifest.description)}</Description>
    <Tags>${xml(tags)}</Tags>
    <Categories>${xml((manifest.categories || []).join(","))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(manifest.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${xml(kinds)}" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Services.Branding.Color" Value="${xml(manifest.galleryBanner?.color || "#050608")}" />
      <Property Id="Microsoft.VisualStudio.Services.Branding.Theme" Value="${xml(manifest.galleryBanner?.theme || "dark")}" />
    </Properties>
    <License>extension/LICENSE.md</License>
    <Icon>extension/${xml(manifest.icon.replace(/^\.\//, ""))}</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${xml(manifest.icon.replace(/^\.\//, ""))}" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
  <Default Extension=".cjs" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".png" ContentType="image/png" />
</Types>
`;

// ---------------------------------------------------------------- zip writer

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// Entry names always use forward slashes, as the zip format requires.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, day } = dosTime(new Date());
  for (const { name, data } of entries) {
    const entryName = Buffer.from(name.split(path.sep).join("/"), "utf8");
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(entryName.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, entryName, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(entryName.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, entryName);
    offset += local.length + entryName.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------------------------------------------------------------- build

function build() {
  for (const file of FILES) {
    if (!fs.existsSync(path.join(extensionDir, file))) throw new Error(`integrations/vscode/${file} is missing`);
  }
  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "extension.vsixmanifest", data: Buffer.from(vsixManifest(), "utf8") },
    ...FILES.map(file => ({ name: `extension/${file}`, data: fs.readFileSync(path.join(extensionDir, file)) }))
  ];
  const out = path.join(extensionDir, `outarch-bridge-${manifest.version}.vsix`);
  fs.writeFileSync(out, zip(entries));
  return out;
}

if (require.main === module) {
  const out = build();
  console.log(`Built ${path.relative(root, out)}`);
  if (process.argv.includes("--install")) {
    try {
      if (process.platform === "win32") execSync(`code --install-extension "${out}" --force`, { stdio: "inherit" });
      else execFileSync("code", ["--install-extension", out, "--force"], { stdio: "inherit" });
      console.log("Installed in VS Code.");
    } catch (error) {
      console.warn(`Could not install with the code command: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = { build, vsixManifest, zip, crc32 };
