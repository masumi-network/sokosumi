"use client";

import { seoSetup } from "./seo-setup-model";
import { useSeoConnectionStatus } from "./use-seo-connection";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * First-run setup, with the one fact Core's rights leave out: whether this
 * workspace can connect a Google account at all. Without that the connect
 * step would be "next" with no button to press.
 */
export function useSeoSetup(model: SeoWorkspaceModel) {
  const setup = seoSetup(model.data, model.filters);
  // Read only while the card offers the connection. Its button reads the same key.
  const offered =
    setup?.steps.some(
      (step) =>
        step.kind === "connect" &&
        (step.state === "next" || step.state === "open"),
    ) ?? false;
  const { status } = useSeoConnectionStatus("search_console", offered);
  return offered && status.data?.status === "unavailable"
    ? seoSetup(model.data, model.filters, false)
    : setup;
}
