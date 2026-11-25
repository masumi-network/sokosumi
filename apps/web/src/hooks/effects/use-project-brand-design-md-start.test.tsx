import { render } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { useProjectBrandDesignMdStart } from "./use-project-brand-design-md-start";

describe("useProjectBrandDesignMdStart", () => {
  it("skips when viewerId is missing and starts once when remounted with a viewerId", () => {
    const order: string[] = [];
    const generate = vi.fn(() => {
      order.push("generate");
    });

    function Probe({
      viewerId,
      websiteUrl,
    }: {
      viewerId: string | undefined;
      websiteUrl: string;
    }) {
      useProjectBrandDesignMdStart(viewerId, websiteUrl, generate);
      useLayoutEffect(() => {
        order.push("layout");
      }, []);
      return null;
    }

    const { rerender } = render(
      <Probe key="" viewerId={undefined} websiteUrl="https://acme.com" />,
    );
    expect(generate).not.toHaveBeenCalled();

    // Rerendering without remounting does not start (mount-only effect).
    rerender(
      <Probe key="" viewerId="viewer-1" websiteUrl="https://acme.com" />,
    );
    expect(generate).not.toHaveBeenCalled();

    // Remounting under the viewer key starts DESIGN.md generation in passive phase.
    order.length = 0;
    rerender(
      <Probe
        key="viewer-1"
        viewerId="viewer-1"
        websiteUrl="https://acme.com"
      />,
    );
    expect(order).toEqual(["layout", "generate"]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({ url: "https://acme.com" });
  });

  it("replays the mount start under StrictMode (matching main verbatim; single-flight lives in generate)", () => {
    const generate = vi.fn();

    function Probe({
      viewerId,
      websiteUrl,
    }: {
      viewerId: string | undefined;
      websiteUrl: string;
    }) {
      useProjectBrandDesignMdStart(viewerId, websiteUrl, generate);
      return null;
    }

    render(
      <StrictMode>
        <Probe viewerId="viewer-1" websiteUrl="https://acme.com" />
      </StrictMode>,
    );

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenNthCalledWith(1, { url: "https://acme.com" });
    expect(generate).toHaveBeenNthCalledWith(2, { url: "https://acme.com" });
  });
});
