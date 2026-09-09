"use client";

import { makeChatRoomChannelName } from "@sokosumi/utils";
import type * as Ably from "ably";
import { useAbly } from "ably/react";
import { useEffect, useRef } from "react";

import { useAblyConnectionHealthPublisher } from "./use-ably-connection-health-publisher";

interface UseSelectedRoomChannelHealthOptions {
  /** The open room; null reports unhealthy and listens to nothing. */
  selectedRoomId: string | null;
  /** Connected and the room channel attached; fired only on change. */
  onHealthChange: (healthy: boolean) => void;
  /**
   * The room channel re-attached without continuity (`resumed: false`),
   * failed, went suspended, or the connection came back after a drop.
   * Messages published in the gap were never delivered; run one read.
   */
  onContinuityLost: (roomId: string) => void;
}

/**
 * Health and continuity of the open room's Ably channel (SOK-986). The
 * membership sync in `useChatRoomRealtime` owns subscribe/detach; this only
 * observes state so the room refresh can pick its cadence and recover once.
 */
export function useSelectedRoomChannelHealth({
  selectedRoomId,
  onHealthChange,
  onContinuityLost,
}: UseSelectedRoomChannelHealthOptions): void {
  const ably = useAbly();
  useAblyConnectionHealthPublisher();
  const onHealthChangeRef = useRef(onHealthChange);
  onHealthChangeRef.current = onHealthChange;
  const onContinuityLostRef = useRef(onContinuityLost);
  onContinuityLostRef.current = onContinuityLost;

  useEffect(() => {
    if (!selectedRoomId) {
      onHealthChangeRef.current(false);
      return;
    }
    const roomId = selectedRoomId;
    // `get` is idempotent; it never attaches on its own.
    const channel = ably.channels.get(makeChatRoomChannelName(roomId));
    // The first attach after mount delivers no gap; only a re-attach can.
    let attachedBefore = channel.state === "attached";
    let lastHealthy: boolean | null = null;

    const publishHealth = () => {
      const healthy =
        ably.connection.state === "connected" && channel.state === "attached";
      if (healthy === lastHealthy) return;
      lastHealthy = healthy;
      onHealthChangeRef.current(healthy);
    };
    const onChannelState = (change: Ably.ChannelStateChange) => {
      publishHealth();
      if (change.current === "attached") {
        // An `update` event also arrives as attached → attached.
        if (attachedBefore && change.resumed === false) {
          onContinuityLostRef.current(roomId);
        }
        attachedBefore = true;
        return;
      }
      if (change.current === "failed" || change.current === "suspended") {
        onContinuityLostRef.current(roomId);
      }
    };
    const onConnectionState = (change: Ably.ConnectionStateChange) => {
      publishHealth();
      if (
        change.current === "connected" &&
        (change.previous === "disconnected" || change.previous === "suspended")
      ) {
        onContinuityLostRef.current(roomId);
      }
    };

    channel.on(onChannelState);
    ably.connection.on(onConnectionState);
    publishHealth();
    return () => {
      channel.off(onChannelState);
      ably.connection.off(onConnectionState);
    };
  }, [ably, selectedRoomId]);
}
