import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
}

function loadPackageMetadata(): {
  name: string;
  version: string;
} {
  const packageUrls = [
    new URL("../../package.json", import.meta.url),
    new URL("../../../package.json", import.meta.url),
  ];
  for (const packageUrl of packageUrls) {
    try {
      const packageJson = require(fileURLToPath(packageUrl)) as PackageMetadata;
      if (
        typeof packageJson.name === "string" &&
        typeof packageJson.version === "string"
      ) {
        return { name: packageJson.name, version: packageJson.version };
      }
    } catch {
      continue;
    }
  }
  throw new Error("Could not load the CLI package metadata");
}

const PACKAGE_METADATA = loadPackageMetadata();

export const CLI_PACKAGE_NAME = PACKAGE_METADATA.name;
export const CLI_VERSION = PACKAGE_METADATA.version;
