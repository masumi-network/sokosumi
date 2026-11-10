"use client";

import { seoSetup } from "./seo-setup-model";
import { useSeoConnectionStatus } from "./use-seo-connection";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * First-run setup, with the one fact Core's workspace leaves out: the state of
 * the reader's Search Console account. It decides whether the connect step is
 * done, and whether this workspace can connect Google at all.
 */
export function useSeoSetup(model: SeoWorkspaceModel) {
  const setup = seoSetup(model.data, model.filters);
  // Read only while the answer can change a step. The card's buttons read the same key.
  const offered =
    setup?.steps.some(
      (step) =>
        step.kind === "connect" &&
        (step.state === "next" || step.state === "open"),
    ) ?? false;
  const { status } = useSeoConnectionStatus("search_console", offered);
  if (!offered) return setup;
  const answer = status.data?.status;
  return seoSetup(
    model.data,
    model.filters,
    status.isPending
      ? "checking"
      : answer === "connected" || answer === "unavailable"
        ? answer
        : "not_connected",
  );
}
