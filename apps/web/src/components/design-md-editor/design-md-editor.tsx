"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import type { ManageableDesignMdOwner } from "@/components/design-md/types";
import { DESIGN_MD_TRANSLATION_NAMESPACE } from "@/components/design-md/types";
import { saveDesignMdUpload } from "@/lib/actions/design-md";

import {
  FullPageMarkdownEditor,
  type FullPageMarkdownEditorLabels,
} from "./full-page-markdown-editor";

interface DesignMdEditorProps {
  initialMarkdown: string;
  owner: ManageableDesignMdOwner;
  returnHref: string;
}

export function DesignMdEditor({
  initialMarkdown,
  owner,
  returnHref,
}: DesignMdEditorProps) {
  const t = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);
  const router = useRouter();
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [isSaving, setIsSaving] = useState(false);

  const labels: FullPageMarkdownEditorLabels = {
    cancel: t("cancel"),
    discardConfirm: t("discardConfirm"),
    discardDialogDescription: t("discardDialogDescription"),
    discardDialogTitle: t("discardDialogTitle"),
    editTab: t("editTab"),
    previewTab: t("previewTab"),
    save: t("editSave"),
    saving: t("editSaving"),
    title: t("editPageTitle"),
  };

  const handleCancel = useCallback(() => {
    router.push(returnHref);
  }, [returnHref, router]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const result = await saveDesignMdUpload({ owner, content: markdown });

      if (!result.ok) {
        toast.error(result.error.message ?? t("saveError"));
        return;
      }

      toast.success(t("editSaveSuccess"));
      router.push(returnHref);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveError"));
    } finally {
      setIsSaving(false);
    }
  }, [markdown, owner, returnHref, router, t]);

  return (
    <FullPageMarkdownEditor
      initialValue={initialMarkdown}
      isSaving={isSaving}
      labels={labels}
      onCancel={handleCancel}
      onSave={() => {
        void handleSave();
      }}
      onValueChange={setMarkdown}
      value={markdown}
    />
  );
}
