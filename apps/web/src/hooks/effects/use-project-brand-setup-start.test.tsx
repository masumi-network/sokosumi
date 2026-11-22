import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useProjectBrandSetupStart } from "./use-project-brand-setup-start";

function SetupProbe({
  generate,
  resolveIcon,
  viewerId,
  websiteUrl,
}: {
  generate: (input: { url: string }) => void;
  resolveIcon: () => void;
  viewerId: string | undefined;
  websiteUrl: string;
}) {
  useProjectBrandSetupStart({ generate, resolveIcon, viewerId, websiteUrl });
  return null;
}

describe("useProjectBrandSetupStart", () => {
  it("resolves the icon without generating when viewerId is missing, and starts both on a keyed remount with viewerId", () => {
    const generate = vi.fn();
    const resolveIcon = vi.fn();

    const { rerender } = render(
      <SetupProbe
        key=""
        generate={generate}
        resolveIcon={resolveIcon}
        viewerId={undefined}
        websiteUrl="https://example.com"
      />,
    );

    expect(resolveIcon).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();

    rerender(
      <SetupProbe
        key="user-1"
        generate={generate}
        resolveIcon={resolveIcon}
        viewerId="user-1"
        websiteUrl="https://example.com"
      />,
    );

    expect(resolveIcon).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({ url: "https://example.com" });
  });
});
