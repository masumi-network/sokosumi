import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Human peer traffic must not depend on Ably alone while a room stays focused.
 * #3582 removed the interval; focus/visibility is not enough when Ably drops
 * or lags — peer rows then land late via createdAt merge between own sends.
 */
describe("room live poll backstop", () => {
  it("wires a focused-room setInterval into RoomsClient", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../rooms-client.tsx"),
      "utf8",
    );
    expect(source).toMatch(/ROOM_LIVE_POLL_MS\s*=\s*\d+/);
    expect(source).toContain("setInterval(refreshLatest, ROOM_LIVE_POLL_MS)");
  });
});
