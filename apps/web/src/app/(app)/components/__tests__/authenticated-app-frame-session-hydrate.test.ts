import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("AuthenticatedAppFrame session hydration", () => {
  it("hydrates the Better Auth client from the RSC session before Header", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../authenticated-app-frame.tsx"),
      "utf8",
    );

    expect(source).toContain('from "./auth-session-hydrator.client"');
    expect(source).toContain("<AuthSessionHydrator session={session} />");

    const hydratorOpen = source.indexOf("<AuthSessionHydrator");
    const headerOpen = source.indexOf("<Header");
    expect(hydratorOpen).toBeGreaterThanOrEqual(0);
    expect(headerOpen).toBeGreaterThan(hydratorOpen);
  });
});
