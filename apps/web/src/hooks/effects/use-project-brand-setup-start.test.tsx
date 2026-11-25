import { render } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { useProjectBrandSetupStart } from "./use-project-brand-setup-start";

describe("useProjectBrandSetupStart", () => {
  it("dispatches resolveIcon before generateDesignMd in passive phase and skips DESIGN.md until remounted with viewerId", () => {
    const order: string[] = [];
    const resolveIcon = vi.fn(() => {
      order.push("resolveIcon");
    });
    const generateDesignMd = vi.fn(() => {
      order.push("generateDesignMd");
    });

    function Probe({
      viewerId,
      websiteUrl,
    }: {
      viewerId: string | undefined;
      websiteUrl: string;
    }) {
      useProjectBrandSetupStart({
        resolveIcon,
        viewerId,
        websiteUrl,
        generateDesignMd,
      });
      useLayoutEffect(() => {
        order.push("layout");
      }, []);
      return null;
    }

    const { rerender } = render(
      <Probe key="" viewerId={undefined} websiteUrl="https://acme.com" />,
    );
    expect(order).toEqual(["layout", "resolveIcon"]);
    expect(generateDesignMd).not.toHaveBeenCalled();

    // Rerendering without remounting does not re-run (mount-only effect).
    rerender(
      <Probe key="" viewerId="viewer-1" websiteUrl="https://acme.com" />,
    );
    expect(resolveIcon).toHaveBeenCalledTimes(1);
    expect(generateDesignMd).not.toHaveBeenCalled();

    // Remounting under the viewer key runs icon first, then DESIGN.md start.
    order.length = 0;
    rerender(
      <Probe
        key="viewer-1"
        viewerId="viewer-1"
        websiteUrl="https://acme.com"
      />,
    );
    expect(order).toEqual(["layout", "resolveIcon", "generateDesignMd"]);
    expect(generateDesignMd).toHaveBeenCalledTimes(1);
    expect(generateDesignMd).toHaveBeenCalledWith({ url: "https://acme.com" });
  });

  it("replays the mount start in icon-first order under StrictMode", () => {
    const order: string[] = [];
    const resolveIcon = vi.fn(() => {
      order.push("resolveIcon");
    });
    const generateDesignMd = vi.fn(() => {
      order.push("generateDesignMd");
    });

    function Probe({
      viewerId,
      websiteUrl,
    }: {
      viewerId: string | undefined;
      websiteUrl: string;
    }) {
      useProjectBrandSetupStart({
        resolveIcon,
        viewerId,
        websiteUrl,
        generateDesignMd,
      });
      return null;
    }

    render(
      <StrictMode>
        <Probe viewerId="viewer-1" websiteUrl="https://acme.com" />
      </StrictMode>,
    );

    expect(order).toEqual([
      "resolveIcon",
      "generateDesignMd",
      "resolveIcon",
      "generateDesignMd",
    ]);
  });
});
