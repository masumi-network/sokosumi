import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectCoreLog } from "@/test/core-log";
import { stubMasumiSyncHttp } from "@/test/masumi-sync-http";

const fields = [
  "PAYMENT_API_URL",
  "PAYMENT_API_KEY",
  "REGISTRY_API_URL",
  "REGISTRY_API_KEY",
] as const;
type Network = "mainnet" | "preprod";
const masks = { complete: 15, partial: 5, missing: 0 };

function setNetwork(network: Network, mask: number) {
  for (const [index, field] of fields.entries()) {
    const variable = `${network === "mainnet" ? "MAINNET" : "PREPROD"}_${field}`;
    const value = process.env[variable];
    if (!value) throw new Error(`Missing test fixture for ${variable}`);
    vi.stubEnv(variable, mask & (1 << index) ? value : undefined);
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DATABASE_SCHEMA_SHARED", "shared");
  vi.stubEnv("DATABASE_SCHEMA_MAINNET", "mainnet");
  vi.stubEnv("DATABASE_SCHEMA_PREPROD", "preprod");
  vi.stubEnv("SOKO_BOT_RUNTIME_ADAPTER", "in-process");
  vi.stubEnv("VERCEL_ENV", undefined);
  for (const field of fields)
    vi.stubEnv(
      field,
      field.endsWith("_URL") ? "https://unused.example.invalid" : "unused",
    );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

for (const mode of ["production", "development"] as const) {
  describe.each(Object.entries(masks))(
    `${mode} Mainnet %s`,
    (_main, mainMask) => {
      describe.each(Object.entries(masks))(
        "Preprod %s",
        (_preprod, preprodMask) => {
          it.each([false, true])(
            "boots and routes with the Preprod switch %s",
            async (flag) => {
              vi.stubEnv("NODE_ENV", mode);
              vi.stubEnv("NETWORK_PREPROD_ENABLED", String(flag));
              setNetwork("mainnet", mainMask);
              setNetwork("preprod", preprodMask);
              const http = stubMasumiSyncHttp();
              const { getEnv } = await import("./env");
              if (mode === "production" && mainMask !== 15) {
                const invalid = expectCoreLog(
                  "error",
                  "Core cannot start, because environment variables are invalid",
                );
                vi.spyOn(process, "exit").mockImplementation(() => {
                  throw new Error("startup refused");
                });
                expect(getEnv).toThrow("startup refused");
                for (const [i, field] of fields.entries())
                  if (!(mainMask & (1 << i))) {
                    expect(
                      JSON.stringify(invalid.map((x) => x.event)),
                    ).toContain(`MAINNET_${field}`);
                  }
                expect(http.requests).toHaveLength(0);
                return;
              }
              const disabled =
                mode === "production" && flag && preprodMask !== 15;
              expectCoreLog(
                "warn",
                "Preprod is disabled because its Masumi configuration is incomplete",
                disabled ? 1 : 0,
              );
              const { captureMessage } = await import("@sentry/node");
              vi.mocked(captureMessage).mockClear();
              expect(getEnv().NETWORK_PREPROD_ENABLED).toBe(flag && !disabled);
              const { isNetworkRoutingEnabled } = await import("@/lib/network");
              expect(isNetworkRoutingEnabled()).toBe(flag);
              expect(captureMessage).toHaveBeenCalledTimes(disabled ? 1 : 0);
              const { masumiClients } = await import("@/clients/masumi");
              for (const [network, configured] of [
                ["mainnet", mainMask === 15],
                ["preprod", flag && preprodMask === 15],
              ] as const) {
                const before = http.requests.length;
                if (!configured) {
                  await expect(async () =>
                    masumiClients(network).payment.getCardanoV2RailReadiness(),
                  ).rejects.toThrow(
                    /Preprod is off|configuration for .* is incomplete/,
                  );
                  expect(http.requests).toHaveLength(before);
                  continue;
                }
                const clients = masumiClients(network);
                expect(clients).toBe(masumiClients(network));
                expect(
                  (await clients.payment.getCardanoV2RailReadiness()).isOk(),
                ).toBe(true);
                expect(
                  (
                    await clients.registry.listEntries({
                      limit: 1,
                      status: ["Online"],
                    })
                  ).isOk(),
                ).toBe(true);
                const host =
                  network === "mainnet"
                    ? "https://example.com"
                    : "https://preprod.example.com";
                expect(
                  http.requests
                    .slice(before)
                    .map((r) => [new URL(r.url).origin, r.credential]),
                ).toEqual([
                  [host, network + " payment"],
                  [host, network + " registry"],
                ]);
              }
            },
          );
        },
      );
    },
  );
}

it.each(Array.from({ length: 15 }, (_, i) => i))(
  "names every missing field for mask %i",
  async (mask) => {
    const { masumiConfiguration } = await import("./masumi");
    for (const network of ["mainnet", "preprod"] as const) {
      setNetwork(network, mask);
      expect(masumiConfiguration(process.env, network).missing).toEqual(
        fields
          .filter((_, i) => !(mask & (1 << i)))
          .map((f) => network.toUpperCase() + "_" + f),
      );
    }
  },
);

it.each([
  ["MAINNET_PAYMENT_API_URL", "   "],
  ["MAINNET_REGISTRY_API_URL", "bad-url"],
  ["MAINNET_PAYMENT_API_KEY", "  "],
  ["MAINNET_REGISTRY_API_KEY", ""],
] as const)(
  "refuses invalid %s before constructing the client",
  async (field, value) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(field, value);
    const node = stubMasumiSyncHttp();
    const { masumiClients } = await import("@/clients/masumi");
    expect(() => masumiClients("mainnet")).toThrow(field);
    expect(node.requests).toHaveLength(0);
  },
);

it.each([
  "http://10.0.0.5:3001/api/v1",
  "http://localhost:3001/api/v1",
  "http://payment:3001/api/v1",
  "ftp://fixture.invalid/api/v1",
])(
  "accepts the existing URL format %s for both services on both Networks",
  async (url) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NETWORK_PREPROD_ENABLED", "true");
    for (const prefix of ["MAINNET", "PREPROD"]) {
      vi.stubEnv(`${prefix}_PAYMENT_API_URL`, url);
      vi.stubEnv(`${prefix}_REGISTRY_API_URL`, url);
    }
    const { getEnv } = await import("./env");
    const { masumiConfiguration } = await import("./masumi");
    const env = getEnv();
    expect(env.NETWORK_PREPROD_ENABLED).toBe(true);
    for (const network of ["mainnet", "preprod"] as const) {
      expect(masumiConfiguration(env, network)).toMatchObject({
        paymentUrl: url,
        registryUrl: url,
      });
    }
  },
);
