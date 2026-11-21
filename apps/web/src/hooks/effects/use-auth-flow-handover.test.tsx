import { render } from "@testing-library/react";
import { useEffect } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberAuthEmailHint } from "@/lib/auth/auth-email-hint";
import { useAuthFlowHandover } from "./use-auth-flow-handover";

describe("useAuthFlowHandover", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("consumes a sign-in handover before passive effects run and respects prefilledEmail", () => {
    rememberAuthEmailHint("Alice@Example.com", {
      signIn: { method: "code", codeSentAt: 1234 },
    });
    const order: string[] = [];
    const onSignInHandover = vi.fn(() => {
      order.push("layout-handover");
    });

    function Probe() {
      useAuthFlowHandover({
        isSignIn: true,
        prefilledEmail: "alice@example.com",
        emailLocked: true,
        onSignInHandover,
        onSignUpHandover: vi.fn(),
      });
      useEffect(() => {
        order.push("passive");
      }, []);
      return null;
    }

    render(<Probe />);
    expect(order).toEqual(["layout-handover", "passive"]);
    expect(onSignInHandover).toHaveBeenCalledWith({
      email: "alice@example.com",
      method: "code",
      codeSentAt: 1234,
    });
  });

  it("discards a mismatched sign-in handover and ignores sign-up handover when locked", () => {
    rememberAuthEmailHint("other@example.com", {
      signIn: { method: "password" },
    });
    const onSignInHandover = vi.fn();
    const onSignUpHandover = vi.fn();

    function SignInProbe() {
      useAuthFlowHandover({
        isSignIn: true,
        prefilledEmail: "invited@example.com",
        emailLocked: true,
        onSignInHandover,
        onSignUpHandover,
      });
      return null;
    }

    render(<SignInProbe />);
    expect(onSignInHandover).not.toHaveBeenCalled();

    rememberAuthEmailHint("new@example.com", { signUp: { codeSentAt: 555 } });
    function LockedSignUpProbe() {
      useAuthFlowHandover({
        isSignIn: false,
        prefilledEmail: "invited@example.com",
        emailLocked: true,
        onSignInHandover,
        onSignUpHandover,
      });
      return null;
    }

    render(<LockedSignUpProbe />);
    expect(onSignUpHandover).not.toHaveBeenCalled();

    // Unlocked sign-up consumes the waiting handover.
    function OpenSignUpProbe() {
      useAuthFlowHandover({
        isSignIn: false,
        prefilledEmail: undefined,
        emailLocked: false,
        onSignInHandover,
        onSignUpHandover,
      });
      return <span>ok</span>;
    }

    render(<OpenSignUpProbe />);
    expect(onSignUpHandover).toHaveBeenCalledWith({
      email: "new@example.com",
      codeSentAt: 555,
    });

    expect(renderToString(<OpenSignUpProbe />)).toBe("<span>ok</span>");
  });
});
