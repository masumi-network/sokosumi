import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("env.public NEXT_PUBLIC_USE_CORE_AUTH_CLIENT coercion", () => {
  const originalValue = process.env.NEXT_PUBLIC_USE_CORE_AUTH_CLIENT;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.NEXT_PUBLIC_USE_CORE_AUTH_CLIENT;
    } else {
      process.env.NEXT_PUBLIC_USE_CORE_AUTH_CLIENT = originalValue;
    }
  });

  it('treats the string "false" as false', async () => {
    process.env.NEXT_PUBLIC_USE_CORE_AUTH_CLIENT = "false";

    const { getEnvPublicConfig } = await import("../env.public");

    expect(getEnvPublicConfig().NEXT_PUBLIC_USE_CORE_AUTH_CLIENT).toBe(false);
  });

  it('treats the string "true" as true', async () => {
    process.env.NEXT_PUBLIC_USE_CORE_AUTH_CLIENT = "true";

    const { getEnvPublicConfig } = await import("../env.public");

    expect(getEnvPublicConfig().NEXT_PUBLIC_USE_CORE_AUTH_CLIENT).toBe(true);
  });

  it("defaults to true when unset", async () => {
    delete process.env.NEXT_PUBLIC_USE_CORE_AUTH_CLIENT;

    const { getEnvPublicConfig } = await import("../env.public");

    expect(getEnvPublicConfig().NEXT_PUBLIC_USE_CORE_AUTH_CLIENT).toBe(true);
  });
});
