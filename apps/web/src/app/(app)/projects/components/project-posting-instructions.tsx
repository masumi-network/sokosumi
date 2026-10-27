"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateProjectPostingInstructions } from "@/lib/actions/project/action";

/** Matches Core's `postingInstructionsMd` limit. */
const POSTING_INSTRUCTIONS_MAX_LENGTH = 20_000;

interface ProjectPostingInstructionsProps {
  projectId: string;
  postingInstructionsMd: string | null;
  /** Closing or closed projects keep their instructions read-only. */
  disabled?: boolean;
}

/**
 * Markdown the team writes for whoever drafts this Project's social posts:
 * Soko Bot, Coworkers and MCP agents read it before drafting.
 */
export function ProjectPostingInstructions({
  projectId,
  postingInstructionsMd,
  disabled = false,
}: ProjectPostingInstructionsProps) {
  const t = useTranslations("App.Projects.PostingInstructions");
  const [saved, setSaved] = useState(postingInstructionsMd ?? "");
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const dirty = value.trim() !== saved.trim();

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const result = await updateProjectPostingInstructions({
        projectId,
        postingInstructionsMd: value,
      });
      if (!result.ok) {
        toast.error(t("saveFailed"));
        return;
      }
      const next = result.value.postingInstructionsMd ?? "";
      setSaved(next);
      setValue(next);
      toast.success(t("saved"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="posting-instructions-title"
      className="bg-card-background space-y-3 rounded-lg border p-4"
      data-testid="project-posting-instructions"
    >
      <div className="space-y-1">
        <Label
          htmlFor="posting-instructions-input"
          id="posting-instructions-title"
          className="text-base font-semibold"
        >
          {t("title")}
        </Label>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <Textarea
        id="posting-instructions-input"
        className="min-h-40"
        disabled={disabled || saving}
        maxLength={POSTING_INSTRUCTIONS_MAX_LENGTH}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t("placeholder")}
        value={value}
      />
      <div className="flex items-center justify-end">
        <Button
          type="button"
          size="sm"
          disabled={disabled || !dirty}
          loading={saving}
          onClick={() => void handleSave()}
        >
          {t("save")}
        </Button>
      </div>
    </section>
  );
}
