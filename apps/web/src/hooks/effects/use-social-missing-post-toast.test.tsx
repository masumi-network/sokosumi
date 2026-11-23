import { render } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

import { useSocialMissingPostToast } from "./use-social-missing-post-toast";

function MissingPostProbe({
  requestedPostId,
  selectedPostId,
  selectedPostFailed = false,
  t,
}: {
  requestedPostId?: string;
  selectedPostId?: string;
  selectedPostFailed?: boolean;
  t: (key: "toasts.missingPost") => string;
}) {
  useSocialMissingPostToast({
    requestedPostId,
    selectedPostId,
    selectedPostFailed,
    t,
  });
  return null;
}

describe("useSocialMissingPostToast", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("toasts once per missing post, skips failed or resolved loads, and re-toasts after clearing", () => {
    const t = vi.fn((key: "toasts.missingPost") => `tr:${key}`);

    const { rerender } = render(
      <Activity mode="visible">
        <MissingPostProbe requestedPostId="post-1" t={t} />
      </Activity>,
    );

    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith("tr:toasts.missingPost", {
      duration: Infinity,
      closeButton: true,
    });

    rerender(
      <Activity mode="hidden">
        <MissingPostProbe requestedPostId="post-1" t={t} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <MissingPostProbe requestedPostId="post-1" t={t} />
      </Activity>,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <MissingPostProbe requestedPostId="post-1" selectedPostFailed t={t} />
      </Activity>,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(1);

    rerender(
      <Activity mode="visible">
        <MissingPostProbe requestedPostId="post-1" t={t} />
      </Activity>,
    );
    expect(toastErrorMock).toHaveBeenCalledTimes(2);
  });
});
