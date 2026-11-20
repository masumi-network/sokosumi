import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRevokeObjectUrl } from "./use-revoke-object-url";

describe("useRevokeObjectUrl", () => {
  beforeEach(() => {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when url is null or undefined", () => {
    const { rerender, unmount } = renderHook(
      ({ url }: { url: string | null | undefined }) => useRevokeObjectUrl(url),
      { initialProps: { url: undefined as string | null | undefined } },
    );

    rerender({ url: null });
    unmount();

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("keeps the url alive while mounted and revokes it on change and unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ url }: { url: string | undefined }) => useRevokeObjectUrl(url),
      { initialProps: { url: "blob:first" as string | undefined } },
    );

    rerender({ url: "blob:first" });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    rerender({ url: "blob:second" });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenLastCalledWith("blob:first");

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenLastCalledWith("blob:second");
  });

  it("revokes the previous url when cleared to undefined", () => {
    const { rerender, unmount } = renderHook(
      ({ url }: { url: string | undefined }) => useRevokeObjectUrl(url),
      { initialProps: { url: "blob:one" as string | undefined } },
    );

    rerender({ url: undefined });
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:one");

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
