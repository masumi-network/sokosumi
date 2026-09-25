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
    const options = useEveAgentMock.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    // Ownership is established server-side, inside session creation. A client
    // `onSessionChange` binding step is what raced.
    expect(options.onSessionChange).toBeUndefined();
    expect(options.prewarm).toBeUndefined();
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
