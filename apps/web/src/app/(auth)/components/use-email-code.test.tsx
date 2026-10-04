import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEmailCode } from "./use-email-code";

const sendVerificationOtp = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.has = () => true;
    return t;
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => sendVerificationOtp(...args),
    },
    signIn: { emailOtp: vi.fn() },
  },
}));

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type SendResult = {
  data: { success: boolean } | null;
  error: { message: string } | null;
};

describe("useEmailCode sendCode", () => {
  beforeEach(() => {
    sendVerificationOtp.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  function renderCode() {
    return renderHook(() =>
      useEmailCode({ eventType: "signIn", returnUrl: "/chat" }),
    );
  }

  function sent(): SendResult {
    return { data: { success: true }, error: null };
  }

  /** Starts a send. The caller flushes microtasks so the request is in flight. */
  function startSend(
    result: { current: ReturnType<typeof useEmailCode> },
    email: string,
  ): Promise<number | null> {
    let pending!: Promise<number | null>;
    act(() => {
      pending = result.current.sendCode(email);
    });
    return pending;
  }

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("keeps the newer address when an earlier send answers later", async () => {
    const earlier = deferred<SendResult>();
    const later = deferred<SendResult>();
    sendVerificationOtp.mockImplementation(({ email }: { email: string }) =>
      email === "ada@example.com" ? earlier.promise : later.promise,
    );

    const { result } = renderCode();
    const earlierSend = startSend(result, "ada@example.com");
    await flush();
    expect(sendVerificationOtp).toHaveBeenCalledTimes(1);
    const laterSend = startSend(result, "bob@example.com");
    await flush();
    expect(sendVerificationOtp).toHaveBeenCalledTimes(2);

    await act(async () => {
      later.resolve(sent());
      await laterSend;
    });
    expect(result.current.sentTo).toBe("bob@example.com");

    await act(async () => {
      earlier.resolve(sent());
      await expect(earlierSend).resolves.toBeNull();
    });
    expect(result.current.sentTo).toBe("bob@example.com");
    expect(result.current.isSending).toBe(false);
  });

  it("does not toast a slower send's refusal after a newer one went out", async () => {
    const earlier = deferred<SendResult>();
    const later = deferred<SendResult>();
    sendVerificationOtp.mockImplementation(({ email }: { email: string }) =>
      email === "ada@example.com" ? earlier.promise : later.promise,
    );

    const { result } = renderCode();
    const earlierSend = startSend(result, "ada@example.com");
    await flush();
    const laterSend = startSend(result, "bob@example.com");
    await flush();

    await act(async () => {
      later.resolve(sent());
      await laterSend;
    });
    expect(result.current.sentTo).toBe("bob@example.com");

    await act(async () => {
      earlier.resolve({ data: null, error: { message: "nope" } });
      await earlierSend;
    });
    expect(result.current.sentTo).toBe("bob@example.com");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
