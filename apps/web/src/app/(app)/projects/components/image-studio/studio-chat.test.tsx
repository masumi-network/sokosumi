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

const { sendMock, prewarmMock, useEveAgentMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  prewarmMock: vi.fn(),
  useEveAgentMock: vi.fn(),
}));

vi.mock("eve/react", () => ({ useEveAgent: useEveAgentMock }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { StudioChat } from "./studio-chat";

import { TEST_LABELS } from "./studio-fixtures";
import type { StudioAsset } from "./types";

function agentState(overrides: Record<string, unknown> = {}) {
  return {
    status: "idle",
    error: undefined,
    session: null,
    messages: [],
    send: sendMock,
    prewarm: prewarmMock,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue(undefined);
  prewarmMock.mockResolvedValue(undefined);
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
      assets={[]}
      onSelectResult={() => {}}
      projectId="project-1"
      labels={TEST_LABELS}
      selectedAsset={null}
      onActivity={() => {}}
    />,
  );
}

describe("the first message", () => {
  it("is sent on the first try, with no session yet", async () => {
    renderChat();

    const box = screen.getByPlaceholderText("placeholder");
    fireEvent.change(box, { target: { value: "a cup on a table" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });

    // Previously gated behind a binding the browser had to perform first,
    // which a single render could never observe completing.
    expect(sendMock).toHaveBeenCalledWith("a cup on a table");
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

    const box = screen.getByPlaceholderText("placeholder");
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

    const box = screen.getByPlaceholderText("placeholder");
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

describe("project conversation", () => {
  it("applies completed headline saves and lets the user open the updated ad", () => {
    const asset = {
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      projectId: "project-1",
    } as StudioAsset;
    const output = {
      assetId: asset.id,
      headline: { text: "Brew at your own pace.", revision: 2 },
    };
    const result = {
      type: "tool",
      callId: "save",
      state: "completed",
      name: "ad_headline",
      output,
    };
    const messages = [
      { id: "older", role: "assistant", parts: [result] },
      {
        id: "user",
        role: "user",
        parts: [{ type: "text", text: "Change the headline" }],
      },
      {
        id: "updated",
        role: "assistant",
        parts: [
          {
            ...result,
            callId: "read",
            output: { headline: output.headline, approvedLines: [] },
          },
          result,
          { ...result, callId: "failed", state: "failed" },
        ],
      },
    ];
    useEveAgentMock.mockImplementation(() =>
      agentState({ messages: messages.slice(1) }),
    );
    const onActivity = vi.fn();
    const onPreviewAd = vi.fn();
    render(
      <StudioChat
        assets={[asset]}
        labels={TEST_LABELS}
        onActivity={onActivity}
        onPreviewAd={onPreviewAd}
        onSelectResult={() => {}}
        projectId={asset.projectId}
        selectedAsset={null}
      />,
    );
    const finish = latestOptions().onFinish;
    if (typeof finish !== "function")
      throw new Error("Missing turn completion handler");
    finish({ messages });
    expect(onActivity).toHaveBeenCalledExactlyOnceWith([output]);
    fireEvent.click(screen.getByRole("button", { name: "viewUpdatedAd" }));
    expect(onPreviewAd).toHaveBeenCalledExactlyOnceWith(asset);
  });

  it("lets the user keep editing a result once its job produces an ad", () => {
    const ad = {
      id: "new-ad",
      jobId: "refine-job",
      projectId: "project-1",
      version: 2,
    } as StudioAsset;
    useEveAgentMock.mockImplementation(() =>
      agentState({
        messages: [
          {
            id: "reply",
            role: "assistant",
            parts: [
              {
                type: "tool",
                callId: "call",
                label: "Refine the headline",
                output: { jobId: ad.jobId },
              },
            ],
          },
        ],
      }),
    );
    const onSelectResult = vi.fn();
    const props = {
      labels: TEST_LABELS,
      onActivity: () => {},
      onSelectResult,
      projectId: ad.projectId,
      selectedAsset: null,
    };
    const view = render(<StudioChat assets={[]} {...props} />);
    expect(
      screen.queryByRole("button", { name: "editResult" }),
    ).not.toBeInTheDocument();
    view.rerender(<StudioChat assets={[ad]} {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "editResult" }));
    expect(onSelectResult).toHaveBeenCalledExactlyOnceWith(ad);
  });

  it("resumes a saved session for this project", () => {
    window.sessionStorage.setItem(
      "sokosumi:image-studio:session:project-1",
      "wrun_saved",
    );
    renderChat();
    expect(latestOptions().initialSession).toEqual({
      sessionId: "wrun_saved",
      streamIndex: 0,
    });
    expect(latestOptions().resume).toBe(true);
  });

  it("blocks another send while a paid request may still be in flight", async () => {
    useEveAgentMock.mockImplementation(() => agentState({ status: "busy" }));
    renderChat();
    const box = screen.getByPlaceholderText("placeholder");
    fireEvent.change(box, { target: { value: "Try again" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(box).toHaveValue("Try again");
  });
});

describe("a retry the person has edited", () => {
  it("finds the earlier conversation first, then says the new thing into it", async () => {
    // Reusing the earlier attempt's name for a different message asks the
    // agent to create that conversation once — and it answers with the one
    // that already exists, having said nothing. The edited message vanished.
    renderChat();
    const box = screen.getByPlaceholderText("placeholder");
    fireEvent.change(box, { target: { value: "original request" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });
    const headers = latestOptions().headers as () => Record<string, string>;
    const attempt = headers()["x-sokosumi-studio-intent"];
    expect(attempt).toBeTruthy();

    fireEvent.change(box, { target: { value: "a different request" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });

    // The conversation is resolved without saying anything, and only then is
    // the new message sent. The earlier attempt's name is still what finds it.
    expect(prewarmMock).toHaveBeenCalledTimes(1);
    expect(headers()["x-sokosumi-studio-intent"]).toBe(attempt);
    expect(sendMock).toHaveBeenLastCalledWith("a different request");
  });

  it("still replays an unchanged retry under the same name", async () => {
    renderChat();
    const box = screen.getByPlaceholderText("placeholder");
    fireEvent.change(box, { target: { value: "same request" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });
    fireEvent.change(box, { target: { value: "same request" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });

    // Nothing to resolve: this is the same attempt, and create-once is right.
    expect(prewarmMock).not.toHaveBeenCalled();
  });

  it("counts a changed selection as a changed message", async () => {
    const { rerender } = render(
      <StudioChat
        assets={[]}
        onSelectResult={() => {}}
        projectId="project-1"
        labels={TEST_LABELS}
        selectedAsset={{ id: "old", version: 1, prompt: "old" } as never}
        onActivity={() => {}}
      />,
    );
    const box = screen.getByPlaceholderText("placeholder");
    fireEvent.change(box, { target: { value: "make this warmer" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });

    rerender(
      <StudioChat
        assets={[]}
        onSelectResult={() => {}}
        projectId="project-1"
        labels={TEST_LABELS}
        selectedAsset={{ id: "new", version: 2, prompt: "new" } as never}
        onActivity={() => {}}
      />,
    );
    fireEvent.change(box, { target: { value: "make this warmer" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });

    // Same words, different referent — so it is a different thing to say.
    expect(prewarmMock).toHaveBeenCalledTimes(1);
  });

  it("provides the selected ad's source, product and placement with a turn", () => {
    const selectedAsset = {
      id: "source-ad",
      projectId: "project-1",
      version: 3,
      model: "vendor/model-a",
      prompt: "Stoneware on a shelf",
      settings: { aspectRatio: "9:16" },
      product: { id: "mug", name: "Stoneware mug" },
    } as never;
    render(
      <StudioChat
        assets={[]}
        onSelectResult={() => {}}
        labels={TEST_LABELS}
        onActivity={() => {}}
        projectId="project-1"
        selectedAsset={selectedAsset}
      />,
    );
    const prepare = latestOptions().prepareSend as (value: object) => unknown;
    expect(prepare({ message: "Change the headline" })).toMatchObject({
      message: "Change the headline",
      clientContext: {
        selectedVersionId: "source-ad",
        selectedVersionNumber: 3,
        selectedVersionSettings: { aspectRatio: "9:16" },
        selectedProduct: { id: "mug", name: "Stoneware mug" },
      },
    });
  });
});

describe("a first message whose delivery cannot be confirmed", () => {
  it("attaches to the conversation the agent named, instead of starting another", async () => {
    // The agent reports the uncertain delivery while the send is in flight.
    let release: (() => void) | undefined;
    sendMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderChat();
    const box = screen.getByPlaceholderText("placeholder");
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
      (screen.getByPlaceholderText("placeholder") as HTMLTextAreaElement).value,
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
    sendMock.mockRejectedValueOnce(new Error("offline"));
    renderChat();

    const box = screen.getByPlaceholderText("placeholder");
    fireEvent.change(box, { target: { value: "keep me" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });

    expect((box as HTMLTextAreaElement).value).toBe("keep me");
  });

  it("does not overwrite something newer the person has typed", async () => {
    const pending = Promise.withResolvers<void>();
    sendMock.mockReturnValueOnce(pending.promise);
    renderChat();

    const box = screen.getByPlaceholderText("placeholder");
    fireEvent.change(box, { target: { value: "first" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });
    // While the send is still in flight, the person starts a new message.
    fireEvent.change(box, { target: { value: "second thoughts" } });
    await act(async () => {
      pending.reject(new Error("offline"));
    });

    expect((box as HTMLTextAreaElement).value).toBe("second thoughts");
  });
});
