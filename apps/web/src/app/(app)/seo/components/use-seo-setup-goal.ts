import { useState } from "react";
import { type BriefPage, briefPage, canSetBriefPage } from "./seo-brief-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

type Action = BriefPage["action"];

/** Setup keeps an edit local. Only the final launch can write the brief or start the check. */
export function useSeoSetupGoal(
  model: SeoWorkspaceModel,
  pageId: string,
  full: boolean,
) {
  const data = model.brief.data;
  const atPageLimit = Boolean(
    data &&
      Number.isInteger(data.revision) &&
      !canSetBriefPage(data.pages, pageId),
  );
  const brief =
    data && Number.isInteger(data.revision) && !atPageLimit ? data : undefined;
  const saved = briefPage(brief?.pages ?? [], pageId);
  const [choice, setChoice] = useState<{
    pageId: string;
    revision: number;
    action: Action;
    share: boolean;
  } | null>(null);
  // The parent keys setup by viewer, workspace and page selection. A brief revision also invalidates its consent.
  const current =
    choice?.pageId === pageId && choice.revision === brief?.revision
      ? choice
      : null;
  if (choice && !current) setChoice(null);
  const action = current ? current.action : saved.action;
  const share = full && Boolean(action) && current?.share === true;
  const changed = current !== null && action !== saved.action;

  function choose(action: Action, share = false) {
    if (brief) setChoice({ pageId, revision: brief.revision, action, share });
  }

  function review() {
    if (!model.data.availableActions.canRequestAnalysis) return;
    model.openAnalysis(
      full ? "audit_full" : "page_check",
      brief && (changed || share)
        ? { pageId, revision: brief.revision, action, changed, share }
        : undefined,
    );
    // Review owns this approval. Cancel keeps the draft and asks again before sharing it.
    if (share) choose(action);
  }

  return {
    canEdit: Boolean(brief),
    atPageLimit,
    action,
    role: saved.role,
    changed,
    share,
    choose,
    review,
    setShare: (value: boolean) => choose(action, value),
  };
}
