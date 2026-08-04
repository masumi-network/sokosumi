import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("RoomsClient Ably island", () => {
  it("wraps rooms ChannelProvider + bridge in local LazyAblyProvider", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../rooms-client.tsx"),
      "utf8",
    );

    expect(source).toContain('from "@/contexts/lazy-ably-provider"');
    expect(source).toMatch(
      /LazyAblyProvider>\s*<ChannelProvider[\s\S]*RoomMessageRealtimeBridge[\s\S]*<\/ChannelProvider>\s*<\/LazyAblyProvider>/,
    );
    expect(source).toContain('<main className="relative flex min-h-0 flex-1">');
  });
});
