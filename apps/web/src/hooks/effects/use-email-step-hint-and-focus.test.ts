import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { takeAuthEmailHintMock } = vi.hoisted(() => ({
  takeAuthEmailHintMock: vi.fn<() => string | null>(),
}));

vi.mock("@/lib/auth/auth-email-hint", () => ({
  takeAuthEmailHint: () => takeAuthEmailHintMock(),
}));

import { useEmailStepHintAndFocus } from "./use-email-step-hint-and-focus";

describe("useEmailStepHintAndFocus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    takeAuthEmailHintMock.mockReturnValue(null);
  });

  it("applies a one-shot email hint, notifies onEmailChange, and focuses email on mount", () => {
    takeAuthEmailHintMock.mockReturnValue("ada@example.com");
    const form = {
      getValues: vi.fn(() => ""),
      setValue: vi.fn(),
      setFocus: vi.fn(),
    };
    const onEmailChange = vi.fn();

    renderHook(() =>
      useEmailStepHintAndFocus({
        form,
        emailLocked: false,
        autoFocus: false,
        onEmailChange,
      }),
    );

    expect(form.setValue).toHaveBeenCalledWith("email", "ada@example.com");
    expect(onEmailChange).toHaveBeenCalledWith("ada@example.com");
    expect(form.setFocus).toHaveBeenCalledWith("email");
  });

  it("does not overwrite a locked or already populated email", () => {
    takeAuthEmailHintMock.mockReturnValue("ada@example.com");
    const form = {
      getValues: vi.fn(() => "existing@example.com"),
      setValue: vi.fn(),
      setFocus: vi.fn(),
    };

    renderHook(() =>
      useEmailStepHintAndFocus({
        form,
        emailLocked: false,
        autoFocus: true,
      }),
    );

    expect(form.setValue).not.toHaveBeenCalled();
    expect(form.setFocus).toHaveBeenCalledWith("email");
  });
});
