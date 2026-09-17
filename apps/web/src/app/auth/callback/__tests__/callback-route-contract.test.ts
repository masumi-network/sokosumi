import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(import.meta.dirname, "../../..");

/**
 * Better Auth hard-redirects OAuth / magic-link sign-ins to these pages, so
 * they are a full document load. They must live outside the `(auth)` route
 * group: that layout re-renders the marketing panel with a fresh random hero
 * image on every request, which flashed a second photo mid-login.
 */
describe("auth callback route contract", () => {
  it.each(["signin", "signup"])(
    "/auth/callback/%s renders outside the (auth) marketing layout",
    (name) => {
      expect(existsSync(join(appDir, `auth/callback/${name}/page.tsx`))).toBe(
        true,
      );
      expect(
        existsSync(join(appDir, `(auth)/auth/callback/${name}/page.tsx`)),
      ).toBe(false);
    },
  );
});
