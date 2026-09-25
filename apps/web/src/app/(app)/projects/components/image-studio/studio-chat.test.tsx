import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * First use of the chat, with real React.
 *
 * An independent review reproduced a first-use race here: prewarm created the
 * session and started its stream, binding was kicked off without being awaited,
 * the new authorization guard rejected the pending stream, and completing the
 * binding updated a ref without causing a rerender — so a render that had
 * captured `canSend = false` could never submit. Conversely `canSend` was true
 * while the session was still null, so a quick first message created a
 * message-bearing session before any binding existed.
 *
 * The sequencing problem is gone because the client no longer binds anything:
 * the agent records the conversation inside the request that creates it. These
 * tests hold that ground — a first message must go out on the first try, with
 * no readiness state to wait on.
 */

const { sendMock, useEveAgentMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  useEveAgentMock: vi.fn(),
}));

vi.mock("eve/react", () => ({ useEveAgent: useEveAgentMock }));
vi.mock("@/lib/actions/image-studio/action", () => ({}));

import { StudioChat } from "./studio-chat";

const LABELS = {
  chatTitle: "Studio assistant",
  emptyBody: "Describe the image you need.",
  promptPlaceholder: "Describe the image...",
  send: "Send",
  you: "You",
  studio: "Assistant",
  thinking: "Working",
  assistantError: "Something went wrong",
  assistantErrorHint: "Try again",
  chatUnavailable: "The assistant is unavailable",
  errorRefreshFailed: "Could not refresh",
  retryConnection: "Retry",
} as unknown as Parameters<typeof StudioChat>[0]["labels"];

function agentState(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    error: undefined,
    session: null,
    data: { messages: [] },
    send: sendMock,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue(undefined);
  useEveAgentMock.mockImplementation(() => agentState());
  try {
    window.sessionStorage.clear();
  } catch {
    // Not available in every environment; the component copes without it.
  }
});

/** The options the most recent render handed the hook. */
function latestOptions(): Record<string, unknown> {
  return useEveAgentMock.mock.calls.at(-1)![0] as Record<string, unknown>;
}

function renderChat() {
  return render(
    <StudioChat
      projectId="project-1"
      labels={LABELS}
      selectedAsset={null}
      resumeSessionId={null}
      onActivity={() => {}}
    />,
  );
}

describe("the first message", () => {
  it("is sent on the first try, with no session yet", async () => {
    renderChat();

    const box = screen.getByPlaceholderText("Describe the image...");
    fireEvent.change(box, { target: { value: "a cup on a table" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });

    // Previously gated behind a binding the browser had to perform first,
    // which a single render could never observe completing.
    expect(sendMock).toHaveBeenCalledWith("a cup on a table", undefined);
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("does not ask the browser to bind anything", () => {
    renderChat();
    const options = latestOptions();

    // Ownership is established server-side, inside session creation. A client
    // binding step the first send had to wait for is what raced; nothing here
    // gates the composer on one.
    expect(options.prewarm).toBeUndefined();
    expect(options.initialSession).toBeUndefined();
    expect(options.resume).toBeUndefined();
  });

  it("names the attempt, and keeps the same name when it is retried", async () => {
    renderChat();
    const headers = latestOptions().headers as () => Record<string, string>;
    // Nothing to identify until somebody speaks.
    expect(headers()).toEqual({});

    const box = screen.getByPlaceholderText("Describe the image...");
    fireEvent.change(box, { target: { value: "a cup on a table" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });
    const first = headers()["x-sokosumi-studio-intent"];
    expect(first).toBeTruthy();

    // The retry of a message whose response never arrived is the same attempt.
    fireEvent.change(box, { target: { value: "a cup on a table" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });
    expect(headers()["x-sokosumi-studio-intent"]).toBe(first);
  });

  it("stops naming the attempt once the conversation has an id", async () => {
    renderChat();
    const options = latestOptions();
    const headers = options.headers as () => Record<string, string>;

    const box = screen.getByPlaceholderText("Describe the image...");
    fireEvent.change(box, { target: { value: "a cup on a table" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });
    expect(headers()["x-sokosumi-studio-intent"]).toBeTruthy();

    await act(async () => {
      (options.onSessionChange as (session: unknown) => void)({
        sessionId: "wrun_A",
        streamIndex: 0,
      });
    });

    // From here the session id is the identity.
    expect(headers()).toEqual({});
  });
});

describe("a first message whose delivery cannot be confirmed", () => {
  it("attaches to the conversation the agent named, instead of starting another", async () => {
    // The failure lands while the send is still in flight, as it does in the
    // installed client: the store reports the error, then resolves.
    let release: (() => void) | undefined;
    sendMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderChat();
    const box = screen.getByPlaceholderText("Describe the image...");
    fireEvent.change(box, { target: { value: "make this warmer" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });

    // What the agent answers when it will not guess whether the message ran.
    const uncertain = Object.assign(new Error("unknown"), {
      status: 409,
      code: "initial_turn_uncertain",
      body: JSON.stringify({
        ok: false,
        code: "initial_turn_uncertain",
        sessionId: "wrun_uncertain",
      }),
    });
    await act(async () => {
      (latestOptions().onError as (error: Error) => void)(uncertain);
      release?.();
    });

    const options = latestOptions();
    // Replaying it is how the person finds out what actually happened.
    expect(options.initialSession).toEqual({
      sessionId: "wrun_uncertain",
      streamIndex: 0,
    });
    expect(options.resume).toBe(true);
    // And the message is back in the composer, unsent.
    expect(
      (
        screen.getByPlaceholderText(
          "Describe the image...",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("make this warmer");
  });

  it("ignores an error that names no conversation", async () => {
    renderChat();
    await act(async () => {
      (latestOptions().onError as (error: Error) => void)(new Error("offline"));
    });

    expect(latestOptions().initialSession).toBeUndefined();
  });
});

describe("a message that fails to send", () => {
  it("comes back to the composer", async () => {
    // The installed eve client catches transport errors and resolves anyway,
    // so the outcome is read from its error state rather than from a rejection.
    useEveAgentMock.mockImplementation(() =>
      agentState({ error: new Error("offline") }),
    );
    renderChat();

    const box = screen.getByPlaceholderText("Describe the image...");
    fireEvent.change(box, { target: { value: "keep me" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });

    expect((box as HTMLTextAreaElement).value).toBe("keep me");
  });

  it("does not overwrite something newer the person has typed", async () => {
    let release: (() => void) | undefined;
    sendMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    useEveAgentMock.mockImplementation(() =>
      agentState({ error: new Error("offline") }),
    );
    renderChat();

    const box = screen.getByPlaceholderText("Describe the image...");
    fireEvent.change(box, { target: { value: "first" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });
    // While the send is still in flight, the person starts a new message.
    fireEvent.change(box, { target: { value: "second thoughts" } });
    await act(async () => {
      release?.();
    });

    expect((box as HTMLTextAreaElement).value).toBe("second thoughts");
  });
});
