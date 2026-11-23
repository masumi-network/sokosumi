"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const STATUS_ID = "agent-loading-status";

const subscribe = () => () => {};
const getRegion = () => document.getElementById(STATUS_ID);
const getServerRegion = () => null;

/**
 * The agent pages' one loading announcement, mounted empty with the agent
 * layout so it stands before any skeleton writes into it. A live region
 * inserted with its text is announced inconsistently.
 */
export function AgentLoadingStatusRegion() {
  return <p id={STATUS_ID} role="status" className="sr-only" />;
}

/**
 * Writes the label into the standing region while its skeleton is mounted,
 * and clears it when the skeleton goes. On a server render, and on a first
 * client render before the region is in the DOM, it writes nothing; React
 * re-reads the region after commit and writes then. Stays sync: no
 * cookies, `connection()` or server i18n (Instant Nav).
 */
export function JobsLoadingStatus({ label }: { label: "jobs" | "job" }) {
  const t = useTranslations("App.Agents.Jobs.Loading");
  const region = useSyncExternalStore(subscribe, getRegion, getServerRegion);
  return region ? createPortal(t(label), region) : null;
}
