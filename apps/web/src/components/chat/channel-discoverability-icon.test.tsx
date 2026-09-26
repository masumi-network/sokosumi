import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChannelDiscoverabilityIcon } from "./channel-discoverability-icon";

describe("ChannelDiscoverabilityIcon", () => {
  it("keeps public/private/external icons in equal slots under sidebar svg override", () => {
    const { container } = render(
      <a className="flex items-center gap-2 text-sm [&>svg]:size-4">
        <ChannelDiscoverabilityIcon discoverability="public" />
        <ChannelDiscoverabilityIcon discoverability="private" />
        <ChannelDiscoverabilityIcon discoverability="external" />
        <span className="text-sm">Label</span>
      </a>,
    );

    const slots = [...container.querySelectorAll("a > span")].filter((span) =>
      span.querySelector("svg"),
    );
    expect(slots).toHaveLength(3);

    for (const slot of slots) {
      // Split tokens: `md:size-5` contains the substring `size-5`.
      const tokens = slot.className.split(" ");
      // Outer box matches DM avatars: 28px below md, 20px from md up.
      expect(tokens).toContain("size-7");
      expect(tokens).toContain("md:size-5");
      expect(tokens).toContain("[&_svg]:size-4.5");
      expect(tokens).toContain("md:[&_svg]:size-3.5");
      expect(tokens).toContain("items-center");
      expect(tokens).toContain("justify-center");
    }

    // Direct child of the menu row must not be an svg, or [&>svg]:size-4 wins.
    expect(container.querySelector("a > svg")).toBeNull();
    expect(slots[0]?.className).toEqual(slots[1]?.className);
    expect(slots[0]?.className).toEqual(slots[2]?.className);
  });

  it("uses a distinct lucide icon for external (not hash alone)", () => {
    const { container: publicContainer } = render(
      <ChannelDiscoverabilityIcon discoverability="public" />,
    );
    const { container: privateContainer } = render(
      <ChannelDiscoverabilityIcon discoverability="private" />,
    );
    const { container: externalContainer } = render(
      <ChannelDiscoverabilityIcon discoverability="external" />,
    );

    const publicPath = publicContainer.querySelector("svg")?.innerHTML;
    const privatePath = privateContainer.querySelector("svg")?.innerHTML;
    const externalPath = externalContainer.querySelector("svg")?.innerHTML;

    expect(externalPath).toBeTruthy();
    expect(externalPath).not.toEqual(publicPath);
    expect(externalPath).not.toEqual(privatePath);
  });
});
