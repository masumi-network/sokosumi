"use client";

import { useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { SeoAgentBrief } from "./seo-agent-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const SEO_AUTOREFRESH_KEY = "seo-autorefresh";

/**
 * Hands-off upkeep: stale Search Console data is refreshed once per browser
 * session for this Audit and page selection. It reuses the saved property and
 * the owner's existing native connection; nothing else runs unattended.
 */
export function useSeoAutopilot(
  model: SeoWorkspaceModel,
  brief: SeoAgentBrief,
) {
  const [state, setState] = useState<"idle" | "refreshing" | "failed">("idle");
  async function refresh() {
    if (!brief.refresh || state === "refreshing") return;
    setState("refreshing");
    const saved = await model.refreshSearchStatistics(
      brief.refresh.propertyId,
      true,
    );
    setState(saved ? "idle" : "failed");
  }
  useMountEffect(() => {
    if (!brief.autoRefresh) return;
    const key = `${SEO_AUTOREFRESH_KEY}:${model.viewerKey}:${model.data.auditId ?? model.data.projectId}:${model.data.scope.pageIds.join(",")}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, new Date().toISOString());
    } catch {
      // Without storage the agent cannot prove it has not already refreshed; wait for the user.
      return;
    }
    void refresh();
  });
  return { state, refresh };
}
