"use client";

import { useAbly } from "ably/react";
import { useEffect } from "react";

import { makeCurrentUserNotificationsChannelName } from "./current-notifications-channel.client";
import { isExpectedAblyChannelLifecycleError } from "./safe-detach-channel";

interface ChannelPresenceState {
  /**
   * What Ably was last known to hold for this page. A request that failed
   * leaves it unknown rather than unchanged: the request may still have
   * reached the server, so the next state the tab reaches has to be sent
   * whether or not it matches the one that failed.
   */
  known: "absent" | "present" | "unknown";
  /**
   * Whether Ably may still hold a member for this page. An enter that was
   * sent sets it; only a channel that took its members with it clears it.
   *
   * A leave that was accepted does not clear it. That answer is the
   * acknowledgement, and Ably drops the member it puts back by itself only
   * on the leave that comes back from the server, so a connection lost
   * between the two leaves a member behind. A leave sent for a member that
   * is already gone costs one presence call; a member never left holds back
   * every email for its category's delay, for the rest of the session.
   */
  mayHold: boolean;
  /**
   * How many times the leave now outstanding has been sent again, and the
   * timer for the next attempt. Reset by a request the channel took.
   */
  retriesUsed: number;
  retry: ReturnType<typeof setTimeout> | null;
  /**
   * How many times the tab has said something for this channel. Each request
   * carries the number its call had, so a request that fails can tell whether
   * the tab has said anything newer since: the clear at the top of `sync`
   * reaches a retry that is already waiting, and a request still in flight
   * arms its own after that clear has run.
   */
  asks: number;
  /** Requests for this channel, each waiting for the one before it. */
  queue: Promise<void>;
}

/**
 * How often a refused leave is sent again, and how long between tries.
 *
 * Only a leave. A refused enter costs the reader one email they were looking
 * at the app for, which is the email arriving early rather than not at all. A
 * refused leave leaves a member behind, and Core reads that member as the
 * reader looking: every email of its category then waits its delay, for the
 * rest of the session. Nothing else asks again while the channel stays
 * attached, so this does.
 *
 * Three tries, because a channel that refuses one leave for a reason of its
 * own refuses the next one too: a key granted no presence right refuses every
 * leave for the life of the connection, and asking every quarter minute
 * forever buys the reader nothing. The Apple client keeps the same budget.
 */
const LEAVE_RETRY_LIMIT = 3;
const LEAVE_RETRY_MS = 15_000;

/**
 * One state per channel for the whole page, not per effect: React mounts an
 * effect twice in development, and two queues on one channel would let the
 * second mount's enter overtake the first mount's leave.
 *
 * The channel itself is the key, not its name. Signing in again replaces the
 * Ably client without reloading the page, and the new client's channels hold
 * none of what the old ones were told, so an answer kept under the name would
 * be read as current and stop the new channel from being entered at all.
 */
const presenceByChannel = new WeakMap<object, ChannelPresenceState>();

function presenceStateFor(channel: object): ChannelPresenceState {
  let state = presenceByChannel.get(channel);

  if (!state) {
    state = {
      known: "absent",
      mayHold: false,
      retriesUsed: 0,
      retry: null,
      asks: 0,
      queue: Promise.resolve(),
    };
    presenceByChannel.set(channel, state);
  }

  return state;
}

function isTabInFront(): boolean {
  return document.visibilityState === "visible";
}

/**
 * Tell Core this tab is the one in front (SOK-1090).
 *
 * Core holds a notification email back for a reader who is looking at the
 * app, and sends it now for one who is not. Looking is read as presence on
 * the reader's own notifications channel: this tab enters while it is
 * visible and leaves as soon as the browser calls it hidden. A tab behind
 * another and a window that was minimised are both hidden, so neither holds
 * an email back. A window merely covered by another is the browser's call,
 * and browsers still call that one visible.
 *
 * Enter and leave are one queue, because a reader can flip tabs faster than
 * a round trip: each request waits for the one before it and reads the tab's
 * state when its turn comes, so what the last one leaves behind is the
 * latest state.
 *
 * A channel that is suspended or on its way out is asked nothing. Ably puts
 * back every member it had entered when the channel attaches, hidden tab or
 * not, so the attach is where the tab's state is sent once more. That attach
 * reports as an update instead when the channel was already attached and did
 * not resume, and an update is also how Ably reports a member it put back
 * and had refused, so both events are listened for.
 *
 * A leave an attached channel refuses is sent again on a timer, because
 * neither of those events is coming while it stays attached and a member
 * left behind is what holds emails back.
 */
export function useNotificationFrontPresence(userId: string): void {
  const ably = useAbly();

  useEffect(() => {
    const channelName = makeCurrentUserNotificationsChannelName(userId);
    const channel = ably.channels.get(channelName);
    const state = presenceStateFor(channel);

    /**
     * Bring the channel in line with the tab. `inFront` is read when the
     * request's turn comes unless the caller fixes it, which unmount does.
     * `force` sends the request although what Ably is known to hold already
     * matches: after an attach, that is what it put back, not what it was
     * asked for.
     */
    function sync(inFrontOverride?: boolean, force = false) {
      // What this call decides replaces what a waiting retry was for, so the
      // retry is dropped rather than left to undo it later. Unmount and the
      // remount after it are the case: the retry for the unmount's leave
      // would otherwise fire after the remount had entered.
      if (state.retry !== null) {
        clearTimeout(state.retry);
        state.retry = null;
      }

      const asked = ++state.asks;

      state.queue = state.queue.then(async () => {
        const inFront = inFrontOverride ?? isTabInFront();
        const wanted = inFront ? "present" : "absent";

        if (!force && state.known === wanted) {
          return;
        }

        // A detached or failed channel took its member with it. A suspended
        // or detaching one may still hold it, and cannot be asked: the attach
        // that brings it back asks again.
        if (channel.state === "detached" || channel.state === "failed") {
          state.known = "absent";
          state.mayHold = false;
          return;
        }

        if (channel.state === "suspended" || channel.state === "detaching") {
          return;
        }

        if (!inFront && !state.mayHold) {
          return;
        }

        // Set before the request is sent, not after it answers: an enter
        // whose answer never arrives may still have reached the server.
        if (inFront) {
          state.mayHold = true;
        }

        try {
          await (inFront ? channel.presence.enter() : channel.presence.leave());
          state.known = wanted;
          state.retriesUsed = 0;
        } catch (error) {
          state.known = "unknown";

          // The channel is read again when the timer comes due, not here:
          // one that lost its state in the meantime is answered by the
          // guards above, and its attach sends the answer again anyway.
          //
          // Nothing is armed once the tab has said something newer. This
          // request was sent before that, so what it was for has been
          // answered already, and the retry carries the tab's state from
          // when it was armed: a reader who came back while the leave was in
          // flight would be taken out of presence a quarter of a minute
          // later, with nothing left to put them back.
          if (
            !inFront &&
            asked === state.asks &&
            state.retriesUsed < LEAVE_RETRY_LIMIT
          ) {
            state.retriesUsed += 1;
            state.retry = setTimeout(() => sync(false, true), LEAVE_RETRY_MS);
          }

          if (!isExpectedAblyChannelLifecycleError(error)) {
            console.error("Ably notification presence failed:", error);
          }
        }
      });
    }

    function handleVisibilityChange() {
      sync();
    }

    /**
     * Ably has put back whatever it holds for this tab, or has told us it
     * could not. Both mean the answer it holds may be out of date.
     *
     * An attach reports as `attached`, except onto a channel that was
     * already attached: that reports as an update, and only when it did not
     * resume. One that resumed kept its members on the server and reports
     * nothing, which is the case that needs nothing sent. A member Ably put
     * back by itself and had refused reports as an update as well. That
     * report arrives after the attach this already answered, so answering it
     * too is a second attempt at the enter the first one may have failed.
     */
    function handleRestored() {
      sync(undefined, true);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    channel.on("attached", handleRestored);
    channel.on("update", handleRestored);
    sync();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      channel.off("attached", handleRestored);
      channel.off("update", handleRestored);
      sync(false);
    };
  }, [ably, userId]);
}
