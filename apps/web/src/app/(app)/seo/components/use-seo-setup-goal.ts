import { useRef, useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  type BriefPage,
  briefDraft,
  briefPage,
  canSetBriefPage,
  changeBriefPage,
} from "./seo-brief-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

type Action = BriefPage["action"];

/** Setup edits only this page's desired action. The paid check has its own review and submit. */
export function useSeoSetupGoal(
  model: SeoWorkspaceModel,
  pageId: string,
  full: boolean,
) {
  const data = model.brief.data;
  const brief =
    data &&
    Number.isInteger(data.revision) &&
    canSetBriefPage(data.pages, pageId)
      ? data
      : undefined;
  const saved = briefPage(brief?.pages ?? [], pageId);
  const [choice, setChoice] = useState<{
    revision: number;
    action: Action;
    share: boolean;
  } | null>(null);
  const current = choice?.revision === brief?.revision ? choice : null;
  const action = current ? current.action : saved.action;
  const share = current?.share === true && Boolean(action);
  const [error, setError] = useState<"error" | "conflict" | null>(null);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(false);
  useMountEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  });

  function choose(action: Action) {
    if (!brief) return;
    setChoice({ revision: brief.revision, action, share: false });
    setError(null);
  }
  async function review() {
    if (saving.current) return;
    let revision = brief?.revision;
    if (current && brief && action !== saved.action) {
      saving.current = true;
      setPending(true);
      try {
        const result = await model.brief.saveWithRevision({
          ...briefDraft(brief),
          pages: changeBriefPage(brief.pages, { ...saved, action }),
        });
        if (!mounted.current) return;
        if (typeof result !== "number") {
          setError(result);
          model.setSetupGoalAdvanced(true);
          return;
        }
        revision = result;
      } finally {
        saving.current = false;
        if (mounted.current) setPending(false);
      }
    }
    setChoice(null);
    setError(null);
    model.openAnalysis(
      full ? "audit_full" : "page_check",
      full && share && revision !== undefined
        ? { pageId, revision }
        : undefined,
    );
  }
  return {
    canEdit: Boolean(brief),
    action,
    role: saved.role,
    share,
    pending,
    error,
    choose,
    review,
    setShare: (value: boolean) => {
      if (brief) setChoice({ revision: brief.revision, action, share: value });
    },
    reload: async () => {
      const result = await model.brief.reload();
      if (result.isSuccess && mounted.current) {
        setChoice(null);
        setError(null);
      }
    },
  };
}
