import { describe, expect, it } from "vitest";

import { isActiveUser } from "./auth-active-user";

const NOW = new Date("2026-09-11T12:00:00.000Z");

describe("isActiveUser", () => {
  it("rejects a missing user", () => {
    expect(isActiveUser(null, NOW)).toBe(false);
    expect(isActiveUser(undefined, NOW)).toBe(false);
  });

  it("accepts a user who was never banned", () => {
    expect(isActiveUser({ banned: false, banExpires: null }, NOW)).toBe(true);
    expect(isActiveUser({ banned: null, banExpires: null }, NOW)).toBe(true);
  });

  it("accepts a user whose ban columns are absent", () => {
    // A Better Auth session user carries them as optional, not null.
    expect(isActiveUser({}, NOW)).toBe(true);
  });

  it("rejects a permanent ban", () => {
    expect(isActiveUser({ banned: true, banExpires: null }, NOW)).toBe(false);
  });

  it("rejects a ban whose expiry is absent rather than null", () => {
    expect(isActiveUser({ banned: true }, NOW)).toBe(false);
    expect(isActiveUser({ banned: true, banExpires: undefined }, NOW)).toBe(
      false,
    );
  });

  it("rejects a ban that has not expired yet", () => {
    const banExpires = new Date(NOW.getTime() + 60_000);

    expect(isActiveUser({ banned: true, banExpires }, NOW)).toBe(false);
  });

  it("accepts a ban that has already expired", () => {
    const banExpires = new Date(NOW.getTime() - 60_000);

    expect(isActiveUser({ banned: true, banExpires }, NOW)).toBe(true);
  });

  it("rejects a ban that expires exactly now", () => {
    expect(isActiveUser({ banned: true, banExpires: NOW }, NOW)).toBe(false);
  });

  it("narrows the user so callers can read the selected columns", () => {
    const user: {
      role: string;
      banned: boolean;
      banExpires: Date | null;
    } | null = { role: "admin", banned: false, banExpires: null };

    if (!isActiveUser(user, NOW)) {
      throw new Error("expected an active user");
    }

    expect(user.role).toBe("admin");
  });
});
