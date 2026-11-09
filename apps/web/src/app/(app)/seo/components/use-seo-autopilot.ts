"use client";

import { useEffect, useState } from "react";
import type { SeoAgentBrief } from "./seo-agent-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const SEO_AUTOREFRESH_KEY = "seo-autorefresh";

/**
 * Hands-off upkeep: Search Console data that is stale, or that lacks query rows
 * for over an hour, is refreshed once per browser session for this Audit and
 * page selection. It reuses the saved property and
 * the owner's existing native connection; nothing else runs unattended.
 */
export function useSeoAutopilot(
  model: SeoWorkspaceModel,
  brief: SeoAgentBrief,
) {
  const [state, setState] = useState<"idle" | "refreshing" | "failed">("idle");
  const key = `${SEO_AUTOREFRESH_KEY}:${model.viewerKey}:${model.data.auditId ?? model.data.projectId}:${model.data.scope.pageIds.join(",")}`;
  async function refresh(background = false) {
    if (!brief.refresh || state === "refreshing") return;
    setState("refreshing");
    const saved = await model.refreshSearchStatistics(
      brief.refresh,
      background,
    );
    // A skipped upkeep run may try again the next time the Audit opens.
    if (saved === null)
      try {
        sessionStorage.removeItem(key);
      } catch {}
    setState(saved === false ? "failed" : "idle");
  }
  // The viewer is part of the stored key, so upkeep waits until the session is known.
  const ready = !model.waitingForSession;
  // Runs once the session is known; the stored key stops repeats.
  useEffect(() => {
    if (!ready || !brief.autoRefresh) return;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, new Date().toISOString());
    } catch {
      // Without storage the agent cannot prove it has not already refreshed; wait for the user.
      return;
    }
    void refresh(true);
  }, [ready]);
  return { state, refresh };
}
