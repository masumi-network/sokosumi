"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { editSeoCommand, SEO_MAX_PAGES } from "./seo-form-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function useSeoEdit(model: SeoWorkspaceModel) {
  const t = useTranslations("App.Seo");
  const [workspace] = useState(() => model.data);
  const [keyword] = useState(() => model.editingKeyword);
  async function submit(
    kind: Parameters<typeof editSeoCommand>[0],
    form: FormData,
  ) {
    const members = form.getAll("pageIds");
    if (
      (kind === "scope" || kind === "edit_scope") &&
      (!members.length || members.length > SEO_MAX_PAGES)
    ) {
      toast.error(t("selectPagesLimit", { count: SEO_MAX_PAGES }));
      return;
    }
    await model.execute(editSeoCommand(kind, form, workspace, keyword));
  }
  return { submit, workspace, keyword };
}
