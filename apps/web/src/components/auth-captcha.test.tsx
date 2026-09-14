import type {
  TurnstileInstance,
  TurnstileProps,
} from "@marsidev/react-turnstile";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { track } from "@vercel/analytics";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AuthCaptchaEntry,
  type CaptchaFetchOptions,
  useAuthCaptcha,
} from "./auth-captcha";

let siteKey: string | undefined = "test-site-key";
let widgetProps: TurnstileProps | undefined;
let token: string | undefined;
const reset = vi.fn(() => {
  token = undefined;
});
const result = vi.fn();
const submitAction = vi.fn(async (options: CaptchaFetchOptions) => options);

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "de",
}));
let resolvedTheme: string | undefined = "dark";
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme }),
}));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
vi.mock("@marsidev/react-turnstile", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  const Turnstile = forwardRef<
    Pick<TurnstileInstance, "reset" | "getResponsePromise">,
    TurnstileProps
  >((props, ref) => {
    widgetProps = props;
    useImperativeHandle(ref, () => ({
      reset,
      getResponsePromise: (timeout = 30_000, retry = 100) =>
        new Promise((resolve, reject) => {
          const deadline = setTimeout(
            () => reject(new Error("Timeout")),
            timeout,
          );
          const poll = () => {
            if (token) {
              clearTimeout(deadline);
              resolve(token);
              return;
            }
            setTimeout(poll, retry);
          };
          poll();
        }),
    }));
    return (
      <button
        type="button"
        onClick={() => {
          token = "single-use-token";
          props.onSuccess?.(token);
        }}
      >
        Solve challenge
      </button>
    );
  });
  return { Turnstile };
});

function Consumer({ entry = "signin" }: { entry?: AuthCaptchaEntry }) {
  const { widget, runWithCaptcha } = useAuthCaptcha(entry);
  const [busy, setBusy] = useState(false);
  return (
    <form>
      {widget}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          result(await runWithCaptcha(submitAction));
          setBusy(false);
        }}
      >
        Submit
      </button>
    </form>
  );
}

const verifiedOptions = {
  headers: { "x-captcha-response": "single-use-token" },
};

beforeEach(() => {
  result.mockReset();
  submitAction.mockClear();
  reset.mockClear();
  vi.mocked(track).mockClear();
  siteKey = "test-site-key";
  resolvedTheme = "dark";
  widgetProps = undefined;
  token = undefined;
});

afterEach(() => vi.useRealTimers());

describe("useAuthCaptcha", () => {
  it("renders an invisible pre-verified widget in the caller's locale and theme", () => {
    render(<Consumer />);
    expect(widgetProps?.options).toMatchObject({
      action: "auth",
      appearance: "interaction-only",
      size: "flexible",
      language: "de",
      theme: "dark",
    });
  });

  it("submits with a token that was verified before the click and resets for the next request", async () => {
    const user = userEvent.setup();
    render(<Consumer />);
    await user.click(screen.getByText("Solve challenge"));
    await user.click(screen.getByText("Submit"));
    expect(submitAction).toHaveBeenCalledExactlyOnceWith(verifiedOptions);
    expect(result).toHaveBeenCalledWith(verifiedOptions);
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("waits for a token that arrives after the click", async () => {
    const user = userEvent.setup();
    render(<Consumer />);
    await user.click(screen.getByText("Submit"));
    expect(screen.getByText("Submit")).toBeDisabled();
    expect(submitAction).not.toHaveBeenCalled();
    await user.click(screen.getByText("Solve challenge"));
    await waitFor(() =>
      expect(submitAction).toHaveBeenCalledExactlyOnceWith(verifiedOptions),
    );
    await waitFor(() => expect(screen.getByText("Submit")).toBeEnabled());
  });

  it("reports a widget that failed before the click at once and recovers after a later solve", async () => {
    const user = userEvent.setup();
    render(<Consumer entry="signup" />);
    act(() => widgetProps?.scriptOptions?.onError?.());
    expect(screen.getByRole("alert")).toHaveTextContent("error");
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("Security Check", {
      entry: "signup",
      step: "load_error",
    });
    await user.click(screen.getByText("Submit"));
    expect(submitAction).not.toHaveBeenCalled();
    expect(result).toHaveBeenCalledWith(null);
    expect(track).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText("Solve challenge"));
    await user.click(screen.getByText("Submit"));
    expect(submitAction).toHaveBeenCalledExactlyOnceWith(verifiedOptions);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("gives up after eight seconds without a token", async () => {
    vi.useFakeTimers();
    render(<Consumer />);
    await act(async () => {
      screen.getByText("Submit").click();
    });
    await act(() => vi.advanceTimersByTimeAsync(7_000));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(screen.getByRole("alert")).toHaveTextContent("error");
    expect(result).toHaveBeenCalledWith(null);
    expect(submitAction).not.toHaveBeenCalled();
    expect(screen.getByText("Submit")).toBeEnabled();
  });

  it("asks the visitor to finish the check instead of blaming a blocker after an unsolved timeout", async () => {
    vi.useFakeTimers();
    render(<Consumer />);
    act(() => widgetProps?.onBeforeInteractive?.());
    await act(async () => {
      screen.getByText("Submit").click();
    });
    await act(() => vi.advanceTimersByTimeAsync(8_500));
    expect(screen.getByRole("alert")).toHaveTextContent("missingResponse");
    expect(result).toHaveBeenCalledWith(null);
    expect(submitAction).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith("Security Check", {
      entry: "signin",
      step: "load_error",
    });
  });

  it("keeps a widget error retryable instead of treating it as a load failure", async () => {
    const user = userEvent.setup();
    render(<Consumer />);
    act(() => widgetProps?.onBeforeInteractive?.());
    act(() => widgetProps?.onError?.("110200"));
    expect(track).toHaveBeenCalledWith("Security Check", {
      entry: "signin",
      step: "failed",
    });
    expect(reset).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByText("Submit"));
    expect(submitAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByText("Solve challenge"));
    await waitFor(() =>
      expect(submitAction).toHaveBeenCalledExactlyOnceWith(verifiedOptions),
    );
  });

  it("resets the widget when the token expires so submit waits for a fresh one", () => {
    render(<Consumer />);
    act(() => widgetProps?.onSuccess?.("stale-token"));
    act(() => widgetProps?.onExpire?.("stale-token"));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("tracks interactive challenges and their outcome", async () => {
    render(<Consumer entry="magic-link" />);
    act(() => widgetProps?.onBeforeInteractive?.());
    expect(track).toHaveBeenCalledWith("Security Check", {
      entry: "magic-link",
      step: "interactive",
    });
    await userEvent.click(screen.getByText("Solve challenge"));
    expect(track).toHaveBeenCalledWith("Security Check", {
      entry: "magic-link",
      step: "solved",
    });
    act(() => widgetProps?.onError?.("110200"));
    expect(track).toHaveBeenCalledWith("Security Check", {
      entry: "magic-link",
      step: "failed",
    });
    expect(track).toHaveBeenCalledTimes(3);
  });

  it("takes no room until Cloudflare asks for interaction, and none again after the token is used", async () => {
    const user = userEvent.setup();
    render(<Consumer />);
    const box = screen.getByText("Solve challenge").parentElement;
    expect(box).toHaveClass("absolute", "size-0", "overflow-hidden");
    act(() => widgetProps?.onBeforeInteractive?.());
    expect(box).not.toHaveClass("absolute");
    await user.click(screen.getByText("Solve challenge"));
    expect(box).not.toHaveClass("absolute");
    await user.click(screen.getByText("Submit"));
    expect(box).toHaveClass("absolute", "size-0", "overflow-hidden");
  });

  it("does not mount Turnstile until next-themes has resolved, then keeps that theme", () => {
    resolvedTheme = undefined;
    const { rerender } = render(<Consumer />);
    expect(widgetProps).toBeUndefined();
    expect(screen.queryByText("Solve challenge")).not.toBeInTheDocument();
    resolvedTheme = "light";
    rerender(<Consumer />);
    expect(widgetProps?.options?.theme).toBe("light");
  });

  it("renders nothing on the server so hydration matches", () => {
    const html = renderToString(<Consumer />);
    expect(html).not.toContain("Solve challenge");
    expect(html).toContain("Submit");
  });

  it("preserves local development without a configured widget", async () => {
    siteKey = undefined;
    render(<Consumer />);
    expect(screen.queryByText("Solve challenge")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Submit"));
    expect(result).toHaveBeenCalledWith({});
    expect(submitAction).toHaveBeenCalledExactlyOnceWith({});
  });
});
