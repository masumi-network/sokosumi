import { expectConsole } from "@sokosumi/utils/test-console";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

import { useDriveItemsErrorToast } from "./use-drive-items-error-toast";

describe("useDriveItemsErrorToast", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("logs and toasts only when isError is true", () => {
    expectConsole("error", "Failed to load Drive items");
    const t = vi.fn((key: "loadFilesError") => `tr:${key}`);
    const err = new Error("failed");

    const { rerender } = renderHook(
      ({ isError, error }) => useDriveItemsErrorToast(isError, error, t),
      { initialProps: { isError: false, error: null as unknown } },
    );

    expect(toastErrorMock).not.toHaveBeenCalled();

    rerender({ isError: true, error: err });
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith("tr:loadFilesError");
  });
});
