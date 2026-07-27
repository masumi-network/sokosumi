#!/usr/bin/env node
/**
 * Refreshes the pinned OpenAPI spec snapshots in spec/ from the deployed
 * masumi services. See spec/SPEC_SOURCES.md — update its provenance table
 * after refreshing.
 *
 * Refuses to overwrite a snapshot with a LOWER info.version (a deployment
 * lagging behind the pinned spec); pass FORCE=1 to override.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
  return match ? match.slice(1, 4).map(Number) : null;
}

function isOlderVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] < b[i];
    }
  }
  return false;
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const sources = [
  {
    name: "payment",
    url:
      process.env.PAYMENT_SPEC_URL ??
      "https://masumi-payment-sokosumi-dev-5xwcb.ondigitalocean.app/api-docs",
    outFile: join(packageRoot, "spec", "payment.openapi.json"),
  },
  {
    name: "registry",
    url:
      process.env.REGISTRY_SPEC_URL ??
      "https://masumi-registry-sokosumi-dev-9f342.ondigitalocean.app/api-docs",
    outFile: join(packageRoot, "spec", "registry.openapi.json"),
  },
];

for (const source of sources) {
  const response = await fetch(source.url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    console.error(
      `[fetch-specs] ${source.name}: ${source.url} responded ${response.status}`,
    );
    process.exitCode = 1;
    continue;
  }
  const spec = await response.json();

  let existingVersion;
  try {
    existingVersion = JSON.parse(await readFile(source.outFile, "utf8"))?.info
      ?.version;
  } catch {
    existingVersion = undefined;
  }
  const fetchedVersion = spec?.info?.version;
  if (
    process.env.FORCE !== "1" &&
    isOlderVersion(fetchedVersion, existingVersion)
  ) {
    console.error(
      `[fetch-specs] ${source.name}: refusing to overwrite pinned version ${existingVersion} with older deployed version ${fetchedVersion} (deployment not upgraded yet?). Set FORCE=1 to override.`,
    );
    process.exitCode = 1;
    continue;
  }

  await mkdir(dirname(source.outFile), { recursive: true });
  await writeFile(source.outFile, `${JSON.stringify(spec, null, 2)}\n`);
  console.info(
    `[fetch-specs] ${source.name}: wrote ${source.outFile} (version ${fetchedVersion ?? "unknown"} from ${source.url})`,
  );
}

if (process.exitCode !== 1) {
  console.info(
    "[fetch-specs] done — update spec/SPEC_SOURCES.md provenance and run `pnpm generate:api`",
  );
}
