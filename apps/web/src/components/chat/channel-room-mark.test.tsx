import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChannelRoomMark } from "./channel-room-mark";

type MarkRoom = Parameters<typeof ChannelRoomMark>[0]["room"];

function renderMark(room: Partial<MarkRoom>) {
  const { container } = render(
    <ChannelRoomMark
      room={{
        name: "General",
        discoverability: "public",
        ...room,
      }}
    />,
  );
  const glyph = container.querySelector('[data-slot="channel-glyph"]');
  const tile = container.querySelector('[data-slot="channel-tile"]');
  if (!glyph || !tile) throw new Error("mark did not render both parts");
  return { glyph, tile };
}

describe("ChannelRoomMark", () => {
  it("shows the glyph expanded and the tile only when the sidebar collapses", () => {
    const { glyph, tile } = renderMark({});
    expect(glyph.className).toContain("group-data-[collapsible=icon]:hidden");
    expect(tile.className).toContain("hidden");
    expect(tile.className).toContain(
      "group-data-[collapsible=icon]:inline-flex",
    );
    // 24px, matching the collapsed DM face, so the rail stays one size.
    expect(tile.className).toContain("size-6");
  });

  it("spells the channel name as initials on the tile", () => {
    expect(renderMark({ name: "Team Soko" }).tile.textContent).toBe("TS");
    expect(renderMark({ name: "general" }).tile.textContent).toBe("GE");
  });

  it("marks private and external tiles in the corner and public ones not at all", () => {
    expect(renderMark({}).tile.querySelector("svg")).toBeNull();
    for (const discoverability of ["private", "external", "matched"] as const) {
      expect(
        renderMark({ discoverability }).tile.querySelector("svg"),
      ).not.toBeNull();
    }
  });
});
