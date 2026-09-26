import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { makeChannel, channelRef, envMock, getMock, calls } = vi.hoisted(() => {
  /** A channel of the shape an Ably client hands out for one name. */
  function makeChannel() {
    return {
      state: "attached" as string,
      presence: {
        enter: vi.fn(),
        leave: vi.fn(),
      },
      on: vi.fn(),
      off: vi.fn(),
    };
  }
  return {
    calls: [] as string[],
    makeChannel,
    /** The channel the current Ably client hands out. */
    channelRef: { current: makeChannel() },
    envMock: {
      NEXT_PUBLIC_NETWORK: "Mainnet" as const,
      NEXT_PUBLIC_VERCEL_ENV: "production" as const,
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: "main" as string | undefined,
    },
    getMock: vi.fn(),
  };
});

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => envMock,
}));

vi.mock("ably/react", () => ({
  useAbly: () => ({
    channels: {
      get: (...args: unknown[]) => {
        getMock(...args);
        return channelRef.current;
      },
    },
  }),
}));

import { useNotificationFrontPresence } from "./use-notification-front-presence";

/**
 * The channel this test's reader is handed. The page keeps one presence
 * answer per channel object, so a test that reused one would read the answer
 * the test before it left behind.
 */
let channel = channelRef.current;

/** The page keeps one state per channel, so each test gets its own reader. */
let readers = 0;
function nextUser(): string {
  readers += 1;
  return `user_${readers}`;
}

function setVisibility(state: "visible" | "hidden") {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
}

async function changeVisibility(state: "visible" | "hidden") {
  setVisibility(state);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** The handler the hook gave the channel for one of its events. */
function handlerFor(event: "attached" | "update"): (change?: unknown) => void {
  const call = channel.on.mock.calls.find(([name]) => name === event);
  if (!call) {
    throw new Error(`the hook did not listen for ${event}`);
  }
  return call[1] as (change?: unknown) => void;
}

/** A presence request that settles only when the test says so. */
function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Let the timer for a refused leave come due. */
async function waitForRetry() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
}

describe("useNotificationFrontPresence", () => {
  beforeEach(() => {
    // Every test, not only the ones that wait for a retry: a refused leave
    // arms a timer that outlives its test, and on real timers it would fire
    // into a later one and leave on a channel that test never touched.
    vi.useFakeTimers();
    vi.clearAllMocks();
    calls.length = 0;
    channelRef.current = makeChannel();
    channel = channelRef.current;
    channel.presence.enter.mockImplementation(async () => {
      calls.push("enter");
    });
    channel.presence.leave.mockImplementation(async () => {
      calls.push("leave");
    });
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("enters the reader's own notifications channel while the tab is in front", async () => {
    const userId = nextUser();

    renderHook(() => useNotificationFrontPresence(userId));
    await flush();

    expect(getMock).toHaveBeenCalledWith(`notifications:all:user_${userId}`);
    expect(calls).toEqual(["enter"]);
  });

  it("stays out while the tab is behind another", async () => {
    setVisibility("hidden");

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    expect(calls).toEqual([]);
  });

  it("leaves when the tab goes behind, and enters again when it comes back", async () => {
    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    await changeVisibility("hidden");
    await flush();
    expect(calls).toEqual(["enter", "leave"]);

    await changeVisibility("visible");
    await flush();
    expect(calls).toEqual(["enter", "leave", "enter"]);
  });

  it("waits for the enter to finish before the leave that follows it", async () => {
    const enter = deferred();
    channel.presence.enter.mockReturnValue(enter.promise);

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();
    expect(channel.presence.enter).toHaveBeenCalledTimes(1);

    await changeVisibility("hidden");
    await flush();

    // The enter has not answered, so the leave has not been sent: sent now,
    // it could be answered before the enter and leave the tab present.
    expect(channel.presence.leave).not.toHaveBeenCalled();

    enter.resolve();
    await flush();

    expect(channel.presence.leave).toHaveBeenCalledTimes(1);
  });

  it("keeps one queue for the channel across a remount, so the second enter follows the first leave", async () => {
    const userId = nextUser();
    const enter = deferred();
    channel.presence.enter.mockImplementationOnce(async () => {
      await enter.promise;
      calls.push("enter");
    });

    const first = renderHook(() => useNotificationFrontPresence(userId));
    first.unmount();
    renderHook(() => useNotificationFrontPresence(userId));
    enter.resolve();
    await flush();

    expect(calls).toEqual(["enter", "leave", "enter"]);
  });

  it("leaves when it unmounts while in front", async () => {
    const { unmount } = renderHook(() =>
      useNotificationFrontPresence(nextUser()),
    );
    await flush();

    unmount();
    await flush();

    expect(calls).toEqual(["enter", "leave"]);
    expect(channel.off).toHaveBeenCalledWith(
      "attached",
      handlerFor("attached"),
    );
    expect(channel.off).toHaveBeenCalledWith("update", handlerFor("update"));
  });

  it("asks nothing of a channel that is already gone", async () => {
    const { unmount } = renderHook(() =>
      useNotificationFrontPresence(nextUser()),
    );
    await flush();

    channel.state = "detached";
    unmount();
    await flush();

    expect(calls).toEqual(["enter"]);
  });

  // The attach sends the tab's state again although the last answer
  // matched, so the only thing holding back a pointless leave is the page
  // knowing it entered nothing.
  it("does not leave a channel it never entered", async () => {
    setVisibility("hidden");

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    await act(async () => {
      handlerFor("attached")();
    });
    await flush();

    expect(calls).toEqual([]);
  });

  it("forgets the member a detached channel took with it", async () => {
    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    channel.state = "detached";
    await changeVisibility("hidden");
    await flush();
    expect(calls).toEqual(["enter"]);

    // The channel is back, and holds nothing: the member went with the one
    // that detached, so there is nothing to leave.
    channel.state = "attached";
    await act(async () => {
      handlerFor("attached")();
    });
    await flush();

    expect(calls).toEqual(["enter"]);
  });

  it("forgets the member a failed channel took with it", async () => {
    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    channel.state = "failed";
    await changeVisibility("hidden");
    await flush();

    // The channel is back, and holds nothing: the member went with the one
    // that failed, so there is nothing to leave.
    channel.state = "attached";
    await act(async () => {
      handlerFor("attached")();
    });
    await flush();

    expect(calls).toEqual(["enter"]);
  });

  it("asks a channel on its way out nothing, and sends the tab's state again once it attaches", async () => {
    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    // Detaching still holds the member, and cannot be asked to drop it.
    channel.state = "detaching";
    await changeVisibility("hidden");
    await flush();
    expect(calls).toEqual(["enter"]);

    channel.state = "attached";
    await act(async () => {
      handlerFor("attached")();
    });
    await flush();

    expect(calls).toEqual(["enter", "leave"]);
  });

  // Ably answers a leave before the server passes it back, and drops the
  // member it puts back by itself only on the one it gets back. A leave
  // answered but never passed back would hold every email for its
  // category's delay, so the tab says it again at every restore.
  it("leaves again although the last leave was accepted", async () => {
    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    await changeVisibility("hidden");
    await flush();
    expect(calls).toEqual(["enter", "leave"]);

    await act(async () => {
      handlerFor("attached")();
    });
    await flush();

    expect(calls).toEqual(["enter", "leave", "leave"]);
  });

  // An enter that was refused may still have reached the server, so what it
  // may have entered is left to the leave that follows it.
  it("leaves after an enter whose answer never came", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    channel.presence.enter.mockRejectedValueOnce(new Error("presence refused"));

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();
    expect(consoleError).toHaveBeenCalled();

    setVisibility("hidden");
    await act(async () => {
      handlerFor("attached")();
    });
    await flush();

    expect(calls).toEqual(["leave"]);
  });

  it("asks a suspended channel nothing, and sends the tab's state again once it attaches", async () => {
    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    // Offline with the tab behind: the member may still be held for the
    // reader, and Ably will put it back when the channel attaches.
    channel.state = "suspended";
    await changeVisibility("hidden");
    await flush();
    expect(calls).toEqual(["enter"]);

    channel.state = "attached";
    await act(async () => {
      handlerFor("attached")();
    });
    await flush();

    expect(calls).toEqual(["enter", "leave"]);
  });

  it("enters again on attach although the last answer said it was present", async () => {
    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    await act(async () => {
      handlerFor("attached")();
    });
    await flush();

    expect(calls).toEqual(["enter", "enter"]);
  });

  // An attach onto a channel that was already attached arrives as an update,
  // never as an attached event. So does the one report Ably makes when a
  // member it put back by itself was refused, and that report is the only
  // repair the failure is offered.
  it("sends the tab's state again on every update", async () => {
    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    await act(async () => {
      handlerFor("update")({ resumed: false });
    });
    await flush();
    expect(calls).toEqual(["enter", "enter"]);

    await act(async () => {
      handlerFor("update")({ resumed: true });
    });
    await flush();

    expect(calls).toEqual(["enter", "enter", "enter"]);
  });

  it("starts from nothing when signing in again replaces the Ably client", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const userId = nextUser();
    const { unmount } = renderHook(() => useNotificationFrontPresence(userId));
    await flush();

    // The leave on the way out never lands, so the page is left believing
    // this reader is present.
    channel.presence.leave.mockRejectedValueOnce(new Error("presence refused"));
    unmount();
    await flush();
    expect(consoleError).toHaveBeenCalled();

    const replacement = makeChannel();
    replacement.presence.enter.mockResolvedValue(undefined);
    channelRef.current = replacement;

    renderHook(() => useNotificationFrontPresence(userId));
    await flush();

    expect(replacement.presence.enter).toHaveBeenCalledTimes(1);
  });

  // A request that failed may still have reached the server, so what Ably
  // holds is no longer known. The tab sends the next state it reaches
  // whether or not that state matches the one the failed request asked for.
  it("leaves after an enter that was refused, and enters again on the way back", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    channel.presence.enter.mockRejectedValueOnce(new Error("presence refused"));

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();
    expect(consoleError).toHaveBeenCalled();

    await changeVisibility("hidden");
    await flush();
    await changeVisibility("visible");
    await flush();

    expect(calls).toEqual(["leave", "enter"]);
    expect(channel.presence.enter).toHaveBeenCalledTimes(2);
  });

  it("says the tab's state again after a request that failed asking for it", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const userId = nextUser();
    const { unmount } = renderHook(() => useNotificationFrontPresence(userId));
    await flush();

    setVisibility("hidden");
    channel.presence.leave.mockRejectedValueOnce(new Error("presence refused"));
    unmount();
    await flush();
    expect(consoleError).toHaveBeenCalled();

    // The page is mounted again, still behind another tab. Asking for what
    // the failed request asked for is not a reason to skip it: the failure
    // said nothing about what Ably holds.
    renderHook(() => useNotificationFrontPresence(userId));
    await flush();

    expect(calls).toEqual(["enter", "leave"]);
  });

  /**
   * A member left behind is read by Core as the reader looking at the app,
   * so every email of its category waits its delay for the rest of the
   * session. Nothing asks again while the channel stays attached, so the
   * hook does.
   */
  it("sends a leave the channel refused again", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    channel.presence.leave.mockRejectedValueOnce(new Error("presence refused"));
    await changeVisibility("hidden");
    expect(consoleError).toHaveBeenCalled();
    expect(calls).toEqual(["enter"]);

    await waitForRetry();

    expect(calls).toEqual(["enter", "leave"]);
  });

  /**
   * A channel that refuses one leave for a reason of its own refuses the
   * next: a key granted no presence right refuses every leave for the life
   * of the connection. Asking every quarter minute forever buys the reader
   * nothing.
   */
  it("stops asking after three refusals", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    channel.presence.leave.mockRejectedValue(new Error("presence refused"));

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();
    await changeVisibility("hidden");

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await waitForRetry();
    }

    expect(channel.presence.leave).toHaveBeenCalledTimes(4);
  });

  /**
   * The budget is there for a channel that refuses every leave, not for one
   * that refused once and recovered. A request the channel took says it is
   * answering again, so the next refusal starts from the top.
   */
  it("starts the budget again after a leave the channel took", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    channel.presence.leave.mockRejectedValueOnce(new Error("presence refused"));
    await changeVisibility("hidden");
    await waitForRetry();
    expect(calls).toEqual(["enter", "leave"]);

    await changeVisibility("visible");
    channel.presence.leave.mockRejectedValue(new Error("presence refused"));
    await changeVisibility("hidden");

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await waitForRetry();
    }

    // The first leave was refused once and its retry was taken: two calls.
    // The second is refused every time, so it spends all three tries: four
    // more. A budget that never restarted would have given it one try less.
    expect(channel.presence.leave).toHaveBeenCalledTimes(6);
  });

  /**
   * The reader came back before the timer came due. The retry was for a tab
   * that is no longer behind another, and letting it run would take the
   * member back out.
   */
  it("drops the waiting retry when the tab says something newer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    channel.presence.leave.mockRejectedValueOnce(new Error("presence refused"));
    await changeVisibility("hidden");
    await changeVisibility("visible");

    await waitForRetry();

    expect(calls).toEqual(["enter", "enter"]);
    expect(channel.presence.leave).toHaveBeenCalledTimes(1);
  });

  /**
   * The same case with the leave still in flight when the reader comes back.
   * The retry is armed after the newer answer was asked for, so the clear at
   * the top of `sync` cannot take it back: the request has to know that it is
   * no longer the latest thing the tab said.
   */
  it("drops the retry for a leave the tab had already overtaken", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    let refuse: (error: Error) => void = () => undefined;
    channel.presence.leave.mockImplementationOnce(() => {
      calls.push("leave");
      return new Promise<void>((_, reject) => {
        refuse = reject;
      });
    });

    await changeVisibility("hidden");
    await changeVisibility("visible");

    refuse(new Error("presence refused"));
    await flush();

    await waitForRetry();

    // The reader is looking at the tab. A leave sent now would take the
    // member out with nothing left to put it back, and every email of every
    // category would stop waiting for the rest of the session.
    expect(calls).toEqual(["enter", "leave", "enter"]);
    expect(channel.presence.leave).toHaveBeenCalledTimes(1);
  });

  it("enters again after a leave that was refused", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();

    channel.presence.leave.mockRejectedValueOnce(new Error("presence refused"));
    await changeVisibility("hidden");
    await flush();
    expect(consoleError).toHaveBeenCalled();

    // The reader is back in front of a tab Ably may hold nothing for, so
    // the enter goes although the last request already asked to be present.
    await changeVisibility("visible");
    await flush();

    expect(calls).toEqual(["enter", "enter"]);
  });

  it("reports a refused enter, and stays quiet about a closed connection", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    channel.presence.enter.mockRejectedValueOnce(
      new Error("Connection closed."),
    );

    renderHook(() => useNotificationFrontPresence(nextUser()));
    await flush();
    expect(consoleError).not.toHaveBeenCalled();

    channel.presence.enter.mockRejectedValueOnce(new Error("presence refused"));
    await changeVisibility("hidden");
    await changeVisibility("visible");
    await flush();

    expect(consoleError).toHaveBeenCalledWith(
      "Ably notification presence failed:",
      expect.objectContaining({ message: "presence refused" }),
    );
  });
});
