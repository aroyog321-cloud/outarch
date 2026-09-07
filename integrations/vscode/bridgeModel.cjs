const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function pathApi(platform = process.platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function canonicalPath(value, platform = process.platform) {
  const resolved = pathApi(platform).resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function projectId(root, platform = process.platform) {
  return crypto.createHash("sha256").update(canonicalPath(root, platform)).digest("hex").slice(0, 20);
}

function projectRelativePath(root, file, platform = process.platform) {
  if (typeof root !== "string" || !root || typeof file !== "string" || !file) return null;
  const paths = pathApi(platform);
  const relative = paths.relative(root, file);
  if (!relative || relative === "." || relative.startsWith("..") || paths.isAbsolute(relative)) return null;
  return relative.split(paths.sep).join("/").slice(0, 1024);
}

function resolveProjectFile(root, relativePath, options = {}) {
  const platform = options.platform || process.platform;
  if (typeof relativePath !== "string" || !relativePath || relativePath.length > 1024) return null;
  const paths = pathApi(platform);
  if (paths.isAbsolute(relativePath)) return null;
  const realpathSync = options.realpathSync || fs.realpathSync;
  try {
    const realRoot = realpathSync(root);
    const realFile = realpathSync(paths.resolve(root, relativePath));
    return projectRelativePath(realRoot, realFile, platform) ? realFile : null;
  } catch {
    return null;
  }
}

module.exports = {
  canonicalPath,
  projectId,
  projectRelativePath,
  resolveProjectFile
};
