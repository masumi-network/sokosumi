#!/usr/bin/env node
/**
 * Refreshes the pinned OpenAPI spec snapshots in spec/ from the deployed
 * masumi services. See spec/SPEC_SOURCES.md — update its provenance table
 * after refreshing.
 *
 * Refuses to overwrite a snapshot with a LOWER info.version (a deployment
 * lagging behind the pinned spec); pass FORCE=1 to override.
 *
 * CHECK=1 reports drift instead of writing, exiting non-zero when a pinned
 * snapshot no longer matches its deployment. A snapshot is stale by design,
 * and info.version does not move on every release, so nothing else notices.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
  return match ? match.slice(1, 4).map(Number) : null;
}

export function isOlderVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!b) {
    // No parsable pinned version to protect — nothing to compare against.
    return false;
  }
  if (!a) {
    // Unparsable DEPLOYED version while the pinned one is well-formed: fail
    // closed. The guard exists to refuse suspect deployments, and a spec
    // without a semver info.version is exactly that.
    return true;
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

/**
 * Paths in `spec` that `pinned` does not have, and the reverse.
 *
 * Path membership is the readable half of the report. A path added upstream
 * is a client method Soko cannot call; a path only in the pin is an endpoint
 * the deployment has retired, which is how `GET /x402/budgets` outlived the
 * node that served it.
 */
export function diffSpecPaths(spec, pinned) {
  const live = Object.keys(spec?.paths ?? {});
  const held = Object.keys(pinned?.paths ?? {});
  return {
    added: live.filter((path) => !held.includes(path)).sort(),
    removed: held.filter((path) => !live.includes(path)).sort(),
  };
}

/**
 * Whether the fetched spec differs from the pinned one at all.
 *
 * Compares the serialization this script writes, so "no drift" means exactly
 * "re-running fetch:specs would change nothing". Prose-only edits count as
 * drift on purpose: they still reach the generated client, and the remedy is
 * the same refresh either way.
 */
export function hasSpecDrift(spec, pinned) {
  return JSON.stringify(spec) !== JSON.stringify(pinned);
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Default to the SAME deployments Core calls at runtime — the hosts behind
 * `PAYMENT_API_URL` and `REGISTRY_API_URL` (see apps/core/.env.example).
 *
 * The generated client is only ever as correct as the server it was generated
 * from, so pinning a snapshot taken from a different deployment would freeze a
 * contract nobody actually talks to. That is worse than the live-URL setup this
 * replaced, which at least re-fetched on every codegen: a snapshot is stale by
 * design, and the version guard below would not catch drift between two
 * deployments that share a version number.
 *
 * Override per run when generating against a staging or local node:
 *   PAYMENT_SPEC_URL=... REGISTRY_SPEC_URL=... pnpm fetch:specs
 */
const sources = [
  {
    name: "payment",
    url:
      process.env.PAYMENT_SPEC_URL ?? "https://payment.masumi.network/api-docs",
    outFile: join(packageRoot, "spec", "payment.openapi.json"),
    ...SPEC_LANDMARKS.payment,
  },
  {
    name: "registry",
    url:
      process.env.REGISTRY_SPEC_URL ??
      "https://registry.masumi.network/api-docs",
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

    if (process.env.CHECK === "1") {
      let pinned;
      try {
        pinned = JSON.parse(await readFile(source.outFile, "utf8"));
      } catch {
        console.error(
          `[fetch-specs] ${source.name}: no readable pinned snapshot at ${source.outFile}`,
        );
        process.exitCode = 1;
        continue;
      }
      if (!hasSpecDrift(spec, pinned)) {
        console.info(
          `[fetch-specs] ${source.name}: pinned snapshot matches ${source.url} (version ${spec?.info?.version ?? "unknown"})`,
        );
        continue;
      }
      const { added, removed } = diffSpecPaths(spec, pinned);
      console.error(
        `[fetch-specs] ${source.name}: pinned snapshot is STALE against ${source.url}`,
      );
      console.error(
        `  version: pinned ${pinned?.info?.version ?? "unknown"} vs deployed ${spec?.info?.version ?? "unknown"}`,
      );
      console.error(
        `  paths: pinned ${Object.keys(pinned?.paths ?? {}).length} vs deployed ${Object.keys(spec?.paths ?? {}).length}`,
      );
      for (const path of added) {
        console.error(`  + ${path} (deployed, missing from the client)`);
      }
      for (const path of removed) {
        console.error(`  - ${path} (retired upstream, still generated)`);
      }
      if (added.length === 0 && removed.length === 0) {
        console.error("  no path changes; the drift is inside operations");
      }
      console.error(
        "  fix: pnpm --filter @sokosumi/masumi fetch:specs && pnpm --filter @sokosumi/masumi generate:api, then update spec/SPEC_SOURCES.md",
      );
      process.exitCode = 1;
      continue;
    }

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

  if (process.exitCode === 1) {
    return;
  }
  console.info(
    process.env.CHECK === "1"
      ? "[fetch-specs] done: every pinned snapshot matches its deployment"
      : "[fetch-specs] done: update spec/SPEC_SOURCES.md provenance and run `pnpm generate:api`",
  );
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
