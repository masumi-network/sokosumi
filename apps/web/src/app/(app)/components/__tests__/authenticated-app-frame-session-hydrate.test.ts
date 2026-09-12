import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("AuthenticatedAppFrame session hydration", () => {
  it("places AuthSessionHydrator as an earlier sibling of chrome, not a wrapper", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../authenticated-app-frame.tsx"),
      "utf8",
    );

    expect(source).toContain('from "./auth-session-hydrator.client"');
    // Self-closing: wrapping chrome would flush child layout effects first.
    expect(source).toContain("<AuthSessionHydrator session={session} />");

    const hydratorOpen = source.indexOf("<AuthSessionHydrator");
    const providerOpen = source.indexOf("<NotificationProvider");
    const headerOpen = source.indexOf("<Header");
    expect(hydratorOpen).toBeGreaterThanOrEqual(0);
    expect(providerOpen).toBeGreaterThan(hydratorOpen);
    expect(headerOpen).toBeGreaterThan(providerOpen);
  });

  /**
   * Heal runs in useMountEffect, so a refreshed frame that keeps the same
   * provider instance would never repair the next reader. The identity key
   * remounts it when the session user changes.
   */
  it("remounts NotificationProvider when the session user changes", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../authenticated-app-frame.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "<NotificationProvider key={session.user.id} userId={session.user.id}>",
    );
  });
});
