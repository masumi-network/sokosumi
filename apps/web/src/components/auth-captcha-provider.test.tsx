import type { TurnstileProps } from "@marsidev/react-turnstile";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthCaptchaProvider,
  type CaptchaFetchOptions,
  useAuthCaptcha,
} from "./auth-captcha-provider";

let siteKey: string | undefined = "test-site-key";
let widgetProps: TurnstileProps;
const result = vi.fn();
const submitAction = vi.fn(async (options: CaptchaFetchOptions) => options);

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: (props: TurnstileProps) => {
    widgetProps = props;
    return (
      <button onClick={() => props.onSuccess?.("single-use-token")}>
        Solve challenge
      </button>
    );
  },
}));

function Consumer() {
  const { runWithCaptcha } = useAuthCaptcha();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        result(await runWithCaptcha(submitAction));
        setBusy(false);
      }}
    >
      Submit
    </button>
  );
}

beforeEach(() => {
  result.mockReset();
  submitAction.mockClear();
  siteKey = "test-site-key";
});

afterEach(() => vi.useRealTimers());

describe("AuthCaptchaProvider", () => {
  it("waits for verification and obtains a new token for the next request", async () => {
    const user = userEvent.setup();
    render(
      <AuthCaptchaProvider>
        <Consumer />
      </AuthCaptchaProvider>,
    );
    await user.click(screen.getByText("Submit"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(result).not.toHaveBeenCalled();
    expect(submitAction).not.toHaveBeenCalled();
    await user.click(screen.getByText("Solve challenge"));
    expect(submitAction).toHaveBeenCalledExactlyOnceWith({
      headers: { "x-captcha-response": "single-use-token" },
    });
    expect(result).toHaveBeenCalledWith({
      headers: { "x-captcha-response": "single-use-token" },
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByText("Submit"));
    expect(result).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancels with Escape, restores focus, and ignores a stale challenge callback", async () => {
    const user = userEvent.setup();
    render(
      <AuthCaptchaProvider>
        <Consumer />
      </AuthCaptchaProvider>,
    );
    await user.click(screen.getByText("Submit"));
    const oldSuccess = widgetProps.onSuccess;
    await user.keyboard("{Escape}");
    expect(result).toHaveBeenCalledWith(null);
    expect(submitAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Submit")).toHaveFocus());
    await user.click(screen.getByText("Submit"));
    act(() => oldSuccess?.("stale-token"));
    expect(result).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows an actionable error without releasing a request", async () => {
    render(
      <AuthCaptchaProvider>
        <Consumer />
      </AuthCaptchaProvider>,
    );
    await userEvent.click(screen.getByText("Submit"));
    act(() => widgetProps.scriptOptions?.onError?.());
    expect(screen.getByRole("alert")).toHaveTextContent("error");
    expect(result).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("cancel"));
    expect(result).toHaveBeenCalledWith(null);
    expect(submitAction).not.toHaveBeenCalled();
  });

  it.each(["cancel", "Solve challenge"])(
    "keeps the timed-out check recoverable through %s",
    async (action) => {
      vi.useFakeTimers();
      render(
        <AuthCaptchaProvider>
          <Consumer />
        </AuthCaptchaProvider>,
      );
      fireEvent.click(screen.getByText("Submit"));

      await act(() => vi.advanceTimersByTimeAsync(30_000));

      expect(screen.getByRole("alert")).toHaveTextContent("error");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(result).not.toHaveBeenCalled();
      expect(submitAction).not.toHaveBeenCalled();
      expect(screen.getByText("cancel")).toBeEnabled();

      await act(async () => {
        fireEvent.click(screen.getByText(action));
      });

      expect(result).toHaveBeenCalledExactlyOnceWith(
        action === "cancel"
          ? null
          : { headers: { "x-captcha-response": "single-use-token" } },
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(submitAction).toHaveBeenCalledTimes(action === "cancel" ? 0 : 1);
      expect(screen.getByText("Submit")).toBeEnabled();
    },
  );

  it("cancels a pending request when the provider unmounts", async () => {
    const { unmount } = render(
      <AuthCaptchaProvider>
        <Consumer />
      </AuthCaptchaProvider>,
    );
    await userEvent.click(screen.getByText("Submit"));
    unmount();
    await waitFor(() => expect(result).toHaveBeenCalledWith(null));
    expect(submitAction).not.toHaveBeenCalled();
  });

  it("preserves local development without a configured widget", async () => {
    siteKey = undefined;
    render(
      <AuthCaptchaProvider>
        <Consumer />
      </AuthCaptchaProvider>,
    );
    await userEvent.click(screen.getByText("Submit"));
    expect(result).toHaveBeenCalledWith({});
    expect(submitAction).toHaveBeenCalledExactlyOnceWith({});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
