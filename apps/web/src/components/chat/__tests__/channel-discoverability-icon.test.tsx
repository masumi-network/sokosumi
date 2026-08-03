import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChannelDiscoverabilityIcon } from "../channel-discoverability-icon";

describe("ChannelDiscoverabilityIcon", () => {
  it("keeps hash and lock in equal text-sm slots under sidebar svg override", () => {
    const { container } = render(
      <a className="flex items-center gap-2 text-sm [&>svg]:size-4">
        <ChannelDiscoverabilityIcon discoverability="public" />
        <ChannelDiscoverabilityIcon discoverability="private" />
        <span className="text-sm">Label</span>
      </a>,
    );

    const slots = [...container.querySelectorAll("a > span")].filter((span) =>
      span.querySelector("svg"),
    );
    expect(slots).toHaveLength(2);

    for (const slot of slots) {
      expect(slot.className).toContain("size-3.5");
      expect(slot.className).toContain("[&_svg]:size-3.5");
    }

    // Direct child of the menu row must not be an svg, or [&>svg]:size-4 wins.
    expect(container.querySelector("a > svg")).toBeNull();
    expect(slots[0]?.className).toEqual(slots[1]?.className);
  });
});
