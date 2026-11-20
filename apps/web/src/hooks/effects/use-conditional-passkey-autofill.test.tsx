import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPasskeySignIn = vi.fn();

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    signIn: {
      passkey: (...args: unknown[]) => mockPasskeySignIn(...args),
    },
  },
}));

import { useConditionalPasskeyAutofill } from "./use-conditional-passkey-autofill";

describe("useConditionalPasskeyAutofill", () => {
  const originalPublicKeyCredential = window.PublicKeyCredential;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: originalPublicKeyCredential,
    });
  });

  it("starts conditional passkey autofill when enabled and supported and completes sign-in", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: {
        isConditionalMediationAvailable: vi.fn().mockResolvedValue(true),
      },
    });
    const finish = vi.fn().mockResolvedValue(undefined);
    mockPasskeySignIn.mockResolvedValue({ data: { user: { id: "u1" } } });

    renderHook(() => useConditionalPasskeyAutofill(true, finish));

    await waitFor(() => {
      expect(mockPasskeySignIn).toHaveBeenCalledWith({ autoFill: true });
      expect(finish).toHaveBeenCalledWith({ user: { id: "u1" } });
    });
  });

  it("ignores late autofill completion after unmount and skips when disabled", async () => {
    let resolvePasskey!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePasskey = resolve;
    });
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: {
        isConditionalMediationAvailable: vi.fn().mockResolvedValue(true),
      },
    });
    const finish = vi.fn().mockResolvedValue(undefined);
    mockPasskeySignIn.mockReturnValue(pending);

    const { unmount } = renderHook(() =>
      useConditionalPasskeyAutofill(true, finish),
    );
    await waitFor(() => expect(mockPasskeySignIn).toHaveBeenCalledTimes(1));

    unmount();
    resolvePasskey({ data: { user: { id: "u1" } } });
    await Promise.resolve();
    expect(finish).not.toHaveBeenCalled();

    renderHook(() => useConditionalPasskeyAutofill(false, finish));
    expect(mockPasskeySignIn).toHaveBeenCalledTimes(1);
  });
});
