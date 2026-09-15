const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const vscodeDir = path.join(root, "integrations", "vscode");
const vsixDir = path.join(vscodeDir, "vsix");
const outVsix = path.join(vscodeDir, "mission-control-bridge-0.2.0.vsix");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vsix-build-"));
const extensionDir = path.join(tempDir, "extension");
fs.mkdirSync(extensionDir, { recursive: true });

fs.copyFileSync(path.join(vsixDir, "[Content_Types].xml"), path.join(tempDir, "[Content_Types].xml"));
fs.copyFileSync(path.join(vsixDir, "extension.vsixmanifest"), path.join(tempDir, "extension.vsixmanifest"));

const filesToCopy = ["package.json", "README.md", "bridgeModel.cjs", "extension.cjs"];
for (const file of filesToCopy) {
  fs.copyFileSync(path.join(vscodeDir, file), path.join(extensionDir, file));
}

if (fs.existsSync(outVsix)) {
  fs.unlinkSync(outVsix);
}

const tempZip = path.join(os.tmpdir(), `vsix-${Date.now()}.zip`);
if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);

execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${tempDir}\\*' -DestinationPath '${tempZip}' -Force"`, {
  stdio: "inherit"
});

fs.copyFileSync(tempZip, outVsix);
fs.unlinkSync(tempZip);
fs.rmSync(tempDir, { recursive: true, force: true });
console.log(`VSIX built successfully at ${outVsix}`);

try {
  execSync(`code --install-extension "${outVsix}" --force`, {
    cwd: root,
    stdio: "inherit"
  });
  console.log("VS Code extension re-installed successfully.");
} catch (err) {
  console.warn("Could not auto-install extension with code CLI:", err.message);
}
