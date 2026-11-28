import { vi } from "vitest";

// Scope and SQL table construction both require an enabled, split-layout Preprod.
vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NETWORK_PREPROD_ENABLED: true,
      DATABASE_SCHEMA_SHARED: "shared",
      DATABASE_SCHEMA_MAINNET: "mainnet",
      DATABASE_SCHEMA_PREPROD: "preprod",
    }),
  };
});
