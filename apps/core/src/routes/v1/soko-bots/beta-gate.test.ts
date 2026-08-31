import { describe, expect, it, vi } from "vitest";

const { userFindUniqueMock, envMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  envMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));
vi.mock("@/config/env", () => ({ getEnv: envMock }));

import { isNmkrEmail } from "@sokosumi/utils";

/**
 * The web route 404s outside the whitelisted domains, but the UI gate alone
 * would leave every Core endpoint reachable with a session cookie. These pin
 * the rule the router middleware applies.
 */
describe("Soko Bot beta gate", () => {
  it("admits the whitelisted domain only", () => {
    expect(isNmkrEmail("patrick@nmkr.io")).toBe(true);
    expect(isNmkrEmail("patrick@NMKR.IO")).toBe(true);
    expect(isNmkrEmail("someone@example.com")).toBe(false);
    expect(isNmkrEmail("someone@notnmkr.io")).toBe(false);
    expect(isNmkrEmail(null)).toBe(false);
  });

  it("is not fooled by an address that merely contains the domain", () => {
    // A gate written with `includes` would let all of these through.
    expect(isNmkrEmail("attacker@nmkr.io.example.com")).toBe(false);
    expect(isNmkrEmail("nmkr.io@example.com")).toBe(false);
    expect(isNmkrEmail("a@b@nmkr.io")).toBe(false);
    expect(isNmkrEmail(" patrick@nmkr.io")).toBe(false);
  });

  it("keeps the router gate on every route by living on the router", async () => {
    // A per-handler check would be forgotten by the next endpoint added.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const middleware = source.slice(
      source.indexOf('app.use("*"'),
      source.indexOf("function mapBot"),
    );
    expect(middleware).toContain("isNmkrEmail");
    expect(middleware).toContain("SOKO_BOT_ENABLED");
  });
});
