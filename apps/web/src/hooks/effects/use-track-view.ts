"use client";

import { useEffect, useEffectEvent } from "react";
import { fireGTMEvent } from "@/lib/gtm-events";

export interface TrackViewPropertiesMap {
  view_login_area: undefined;
  view_register_area: undefined;
  view_credits: undefined;
  view_agent: { agentName: string };
}

export type TrackViewEvent = keyof TrackViewPropertiesMap;

function dispatchViewEvent(
  event: TrackViewEvent,
  properties: TrackViewPropertiesMap[TrackViewEvent] | undefined,
): void {
  switch (event) {
    case "view_login_area":
      fireGTMEvent.viewLoginArea();
      break;
    case "view_register_area":
      fireGTMEvent.viewRegisterArea();
      break;
    case "view_credits":
      fireGTMEvent.viewCredits();
      break;
    case "view_agent":
      fireGTMEvent.viewAgent(
        (properties as TrackViewPropertiesMap["view_agent"]).agentName,
      );
      break;
  }
}

/**
 * Fires a typed GTM view event once on mount, or again whenever `key` changes.
 */
export function useTrackView(
  event: "view_login_area" | "view_register_area" | "view_credits",
  key?: unknown,
): void;
export function useTrackView(
  event: "view_agent",
  properties: TrackViewPropertiesMap["view_agent"],
  key?: unknown,
): void;
export function useTrackView(
  event: TrackViewEvent,
  propertiesOrKey?: TrackViewPropertiesMap[TrackViewEvent] | unknown,
  key?: unknown,
): void {
  const hasProperties = event === "view_agent";
  const properties = (hasProperties ? propertiesOrKey : undefined) as
    | TrackViewPropertiesMap[TrackViewEvent]
    | undefined;
  const resetKey = hasProperties ? key : propertiesOrKey;

  const fire = useEffectEvent(() => {
    dispatchViewEvent(event, properties);
  });

  useEffect(() => {
    void resetKey;
    fire();
  }, [resetKey]);
}
