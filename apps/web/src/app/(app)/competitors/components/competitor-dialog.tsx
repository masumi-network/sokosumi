"use client";

import type { ProjectCompetitor } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addCompetitor,
  updateCompetitor,
} from "@/lib/actions/competitors/action";

const FIELDS = [
  "name",
  "websiteUrl",
  "pricingUrl",
  "instagramHandle",
  "facebookHandle",
] as const;
type Field = (typeof FIELDS)[number];

/** Adds a competitor, or changes one; Core's refusal shows above the buttons. */
export function CompetitorDialog({
  competitor,
  onClose,
  projectId,
}: {
  competitor: ProjectCompetitor | null;
  onClose: () => void;
  projectId: string;
}) {
  const t = useTranslations("App.Competitors.form");
  const [draft, setDraft] = useState<Record<Field, string>>({
    name: competitor?.name ?? "",
    websiteUrl: competitor?.websiteUrl ?? "",
    pricingUrl: competitor?.pricingUrl ?? "",
    instagramHandle: competitor?.instagramHandle ?? "",
    facebookHandle: competitor?.facebookHandle ?? "",
  });
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startSaving(async () => {
      // An emptied field clears what was stored.
      const body = {
        name: draft.name,
        websiteUrl: draft.websiteUrl.trim() || null,
        pricingUrl: draft.pricingUrl.trim() || null,
        instagramHandle: draft.instagramHandle.trim() || null,
        facebookHandle: draft.facebookHandle.trim() || null,
      };
      const result = competitor
        ? await updateCompetitor({
            projectId,
            competitorId: competitor.id,
            ...body,
          })
        : await addCompetitor({ projectId, ...body });
      if (result.ok) onClose();
      else setError(result.error.message ?? t("failed"));
    });
  }

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {competitor ? t("editTitle") : t("addTitle")}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          {FIELDS.map((field) => (
            <div className="flex flex-col gap-1.5" key={field}>
              <Label htmlFor={`competitor-${field}`}>
                {t(`${field}.label`)}
              </Label>
              <Input
                autoComplete="off"
                id={`competitor-${field}`}
                maxLength={field === "name" ? 80 : 500}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))
                }
                placeholder={t(`${field}.placeholder`)}
                required={field === "name"}
                value={draft[field]}
              />
            </div>
          ))}
          {error ? (
            <p className="text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button disabled={saving} onClick={onClose} type="button">
              {t("cancel")}
            </Button>
            <Button loading={saving} type="submit" variant="primary">
              {competitor ? t("save") : t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
