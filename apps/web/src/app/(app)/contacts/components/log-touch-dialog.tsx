"use client";
import type { ContactDetail } from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { addMonths, addWeeks, format } from "date-fns";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { contactsService } from "@/lib/services/contacts.client";
import { cn } from "@/lib/utils";
import { refreshContacts } from "./use-contacts-data";

/** A call or meeting is two-way, so it counts as hearing from them. */
const KINDS = [
  { channel: "MANUAL", direction: null },
  { channel: "CALL", direction: "BOTH" },
  { channel: "MEETING", direction: "BOTH" },
] as const;

type Kind = (typeof KINDS)[number]["channel"];

function day(date: Date) {
  return format(date, "yyyy-MM-dd");
}

/** The plan the draft is compared with, and the version it was read at. */
function planOf(contact: ContactDetail) {
  return {
    version: contact.version,
    nextStep: contact.nextStep ?? "",
    followUpAt: contact.followUpAt ?? "",
  };
}

/**
 * Logs a call, meeting or note on the contact's Timeline and sets what comes
 * next in the same write. Next step and follow-up start as they are and are
 * only sent when changed. When a newer contact arrives (a refetch, or the
 * reload after a version conflict), fields the reader left alone take the
 * new values; a field both changed keeps the draft and says so. Render it
 * inside the caller's open `Dialog`, whose `DialogTrigger` gets focus back.
 */
export function LogTouchDialog({
  contact,
  onClose,
}: {
  contact: ContactDetail;
  onClose: () => void;
}) {
  const t = useTranslations("App.Contacts");
  const cache = useQueryClient();
  const [kind, setKind] = useState<Kind>("MANUAL");
  const [summary, setSummary] = useState("");
  const [base, setBase] = useState(() => planOf(contact));
  const [nextStep, setNextStep] = useState(base.nextStep);
  const [followUpAt, setFollowUpAt] = useState(base.followUpAt);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  if (contact.version !== base.version) {
    const fresh = planOf(contact);
    const clash = (draft: string, field: "nextStep" | "followUpAt") =>
      draft !== base[field] &&
      fresh[field] !== base[field] &&
      draft !== fresh[field];
    if (clash(nextStep.trim(), "nextStep") || clash(followUpAt, "followUpAt"))
      setError(t("logTouch.changedMeanwhile"));
    if (nextStep.trim() === base.nextStep) setNextStep(fresh.nextStep);
    if (followUpAt === base.followUpAt) setFollowUpAt(fresh.followUpAt);
    setBase(fresh);
  }
  const presets = [
    { label: t("logTouch.inAWeek"), value: day(addWeeks(new Date(), 1)) },
    { label: t("logTouch.inAMonth"), value: day(addMonths(new Date(), 1)) },
    { label: t("panel.noFollowUp"), value: "" },
  ];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!summary.trim()) {
      setError(t("logTouch.summaryRequired"));
      return;
    }
    const changes = {
      ...(nextStep.trim() !== base.nextStep
        ? { nextStep: nextStep.trim() || null }
        : {}),
      ...(followUpAt !== base.followUpAt
        ? { followUpAt: followUpAt || null }
        : {}),
    };
    const { direction } = KINDS.find((option) => option.channel === kind) ?? {
      direction: null,
    };
    setPending(true);
    setError("");
    try {
      await contactsService.logInteraction(contact.id, {
        occurredAt: new Date(),
        channel: kind,
        direction,
        summary: summary.trim(),
        ...(Object.keys(changes).length
          ? { contact: { version: base.version, ...changes } }
          : {}),
      });
      await refreshContacts(cache, contact.id);
      toast.success(t("logTouch.logged"));
      onClose();
    } catch (caught) {
      const { kind: errorKind, message } = coreErrorOf(caught);
      if (errorKind === "contact_version_conflict") {
        setError(t("errors.versionConflict"));
        await refreshContacts(cache, contact.id);
      } else setError(message ?? t("logTouch.failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <DialogContent className="app-scrollbar max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <form onSubmit={handleSubmit} className="grid gap-5">
        <DialogHeader>
          <DialogTitle>
            {t("logTouch.title", { name: contact.name })}
          </DialogTitle>
          <DialogDescription>{t("logTouch.description")}</DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">
            {t("logTouch.kind")}
          </legend>
          <div className="flex flex-wrap gap-1">
            {KINDS.map(({ channel }) => (
              <label
                key={channel}
                className={cn(
                  "has-focus-visible:ring-ring flex h-10 cursor-pointer items-center rounded-md border px-3 text-sm has-focus-visible:ring-2 md:h-8",
                  kind === channel
                    ? "bg-quaternary border-foreground"
                    : "hover:bg-quinary",
                )}
              >
                <input
                  type="radio"
                  name="log-touch-kind"
                  value={channel}
                  checked={kind === channel}
                  onChange={() => setKind(channel)}
                  className="sr-only"
                />
                {t(`panel.interactionChannels.${channel}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-2">
          <Label htmlFor="log-touch-summary">{t("logTouch.summary")}</Label>
          <Textarea
            id="log-touch-summary"
            value={summary}
            maxLength={300}
            rows={2}
            autoFocus
            aria-invalid={!!error && !summary.trim()}
            aria-describedby={error ? "log-touch-error" : undefined}
            placeholder={t("logTouch.summaryPlaceholder")}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="log-touch-next-step">{t("panel.nextStep")}</Label>
          <Input
            id="log-touch-next-step"
            value={nextStep}
            maxLength={500}
            autoComplete="off"
            placeholder={t("panel.nextStepPlaceholder")}
            onChange={(event) => setNextStep(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="log-touch-follow-up">{t("columns.followUp")}</Label>
          <Input
            id="log-touch-follow-up"
            type="date"
            value={followUpAt}
            className="tabular-nums"
            onChange={(event) => setFollowUpAt(event.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {presets.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={followUpAt === preset.value}
                onClick={() => setFollowUpAt(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
        {error ? (
          <p
            id="log-touch-error"
            role="alert"
            className="text-foreground text-sm"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("logTouch.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            {t("logTouch.submit")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
