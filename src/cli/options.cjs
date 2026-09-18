const path = require("node:path");

const DEFAULT_CONFIG_NAME = "termctl.config.json";

function usage(version) {
  return [
    `OUTARCH ${version}`,
    "",
    "Usage: termctl [options]",
    "       outarch [options]",
    "",
    "Options:",
    "  -c, --config <path>  Use a specific workspace file",
    "      --check          Validate the workspace without starting sessions",
    "  -h, --help           Show this help",
    "  -v, --version        Show the version",
    ""
  ].join("\n");
}

function parseCliArgs(argv, options = {}) {
  const cwd = options.cwd || process.cwd();
  const parsed = {
    configPath: path.resolve(cwd, DEFAULT_CONFIG_NAME),
    configExplicit: false,
    check: false,
    help: false,
    version: false
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--") {
      if (index !== argv.length - 1) {
        throw new Error(`unexpected argument: ${argv[index + 1]}`);
      }
      break;
    }
    if (argument === "-h" || argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (argument === "-v" || argument === "--version") {
      parsed.version = true;
      continue;
    }
    if (argument === "--check") {
      parsed.check = true;
      continue;
    }
    if (argument === "-c" || argument === "--config") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) {
        throw new Error(`${argument} requires a file path`);
      }
      parsed.configPath = path.resolve(cwd, value);
      parsed.configExplicit = true;
      continue;
    }
    if (argument.startsWith("--config=")) {
      const value = argument.slice("--config=".length);
      if (!value) throw new Error("--config requires a file path");
      parsed.configPath = path.resolve(cwd, value);
      parsed.configExplicit = true;
      continue;
    }
    throw new Error(`unknown option: ${argument}`);
  }

  return parsed;
}

module.exports = { DEFAULT_CONFIG_NAME, parseCliArgs, usage };
