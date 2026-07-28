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
import { dirname, join, resolve } from "node:path";
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

export function containsJsonKey(value, targetKey) {
  if (Array.isArray(value)) {
    return value.some((item) => containsJsonKey(item, targetKey));
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (Object.hasOwn(value, targetKey)) {
    return true;
  }
  return Object.values(value).some((item) => containsJsonKey(item, targetKey));
}

export function containsJsonString(value, targetValue) {
  if (value === targetValue) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsJsonString(item, targetValue));
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return Object.values(value).some((item) =>
    containsJsonString(item, targetValue),
  );
}

export const SPEC_LANDMARKS = {
  payment: {
    requiredKeys: [
      "supportedPaymentSourceIndex",
      "PurchaseSources",
      "isPurchaseReady",
    ],
    requiredValues: ["WithdrawAuthorized", "AuthorizeWithdrawalRequested"],
  },
  registry: {
    requiredKeys: [
      "SupportedPaymentSources",
      "supersededByAgentIdentifier",
      "x402ResourcesUrl",
    ],
    requiredValues: ["X402", "Web3CardanoV2"],
  },
};

export function findMissingSpecLandmarks(
  spec,
  { requiredKeys, requiredValues },
) {
  return [
    ...requiredKeys.filter((key) => !containsJsonKey(spec, key)),
    ...requiredValues.filter((value) => !containsJsonString(spec, value)),
  ];
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const sources = [
  {
    name: "payment",
    url:
      process.env.PAYMENT_SPEC_URL ??
      "https://masumi-payment-sokosumi-dev-5xwcb.ondigitalocean.app/api-docs",
    outFile: join(packageRoot, "spec", "payment.openapi.json"),
    ...SPEC_LANDMARKS.payment,
  },
  {
    name: "registry",
    url:
      process.env.REGISTRY_SPEC_URL ??
      "https://masumi-registry-sokosumi-dev-9f342.ondigitalocean.app/api-docs",
    outFile: join(packageRoot, "spec", "registry.openapi.json"),
    ...SPEC_LANDMARKS.registry,
  },
];

async function main() {
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
    const missingLandmarks = findMissingSpecLandmarks(spec, source);
    if (process.env.FORCE !== "1" && missingLandmarks.length > 0) {
      console.error(
        `[fetch-specs] ${source.name}: refusing to overwrite the V2 snapshot; fetched spec is missing ${missingLandmarks.join(", ")}. Set FORCE=1 only for an intentional contract downgrade.`,
      );
      process.exitCode = 1;
      continue;
    }

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
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
