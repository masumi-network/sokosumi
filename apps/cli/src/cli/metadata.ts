import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

interface PackageMetadata {
  version?: unknown;
}

function loadCliVersion(): string {
  const packageUrls = [
    new URL("../../package.json", import.meta.url),
    new URL("../../../package.json", import.meta.url),
  ];
  for (const packageUrl of packageUrls) {
    try {
      const packageJson = require(fileURLToPath(packageUrl)) as PackageMetadata;
      if (typeof packageJson.version === "string") return packageJson.version;
    } catch {
      continue;
    }
  }
  throw new Error("Could not load the CLI package metadata");
}

export const CLI_VERSION = loadCliVersion();
