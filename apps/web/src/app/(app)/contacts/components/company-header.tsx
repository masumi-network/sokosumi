"use client";

import type {
  ContactCompany,
  ContactCompanyDetail,
} from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { contactsService } from "@/lib/services/contacts.client";
import { cn } from "@/lib/utils";
import { AvatarStack, Dot, StageChip } from "./contact-visuals";
import { CONTACT_COMPANY_KEY, useContactCompany } from "./use-contacts-data";

const WARMTH_DOT: Record<ContactCompany["warmth"], string> = {
  warm: "bg-semantic-success",
  cooling: "bg-semantic-warning",
  cold: "bg-muted-foreground",
  none: "bg-quaternary",
};

/**
 * What the team knows about the company in the `company` filter: its facts,
 * the relationship its people add up to, what is planned next and the latest
 * touchpoints. The people themselves are the grid below.
 */
export function CompanyHeader({
  name,
  onOpenContact,
}: {
  name: string;
  onOpenContact: (contactId: string) => void;
}) {
  const t = useTranslations("App.Contacts.company");
  const detail = useContactCompany(name);
  const [editing, setEditing] = useState(false);
  if (detail.isPending)
    return (
      <div className={HOLDER_CLASS}>
        <div className={cn(HOLDER_ITEM_CLASS, "grid gap-3 p-4")} role="status">
          <span className="sr-only">{t("loading")}</span>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    );
  if (!detail.data) return null;
  const { company } = detail.data;
  const facts = [company.industry, company.size, company.headquarters].filter(
    Boolean,
  );
  return (
    <section aria-label={company.name} className={HOLDER_CLASS}>
      <div className={cn(HOLDER_ITEM_CLASS, "grid gap-4 p-4")}>
        <div className="flex items-start gap-3">
          <div className="grid min-w-0 gap-1">
            <h2 className="truncate text-lg font-semibold tracking-tight">
              {company.name}
            </h2>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
              {facts.length ? <span>{facts.join(" · ")}</span> : null}
              {company.website ? (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
                >
                  {company.domain ?? company.website}
                  <ExternalLink aria-hidden className="size-3" />
                </a>
              ) : null}
              {company.linkedinUrl ? (
                <a
                  href={company.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  LinkedIn
                </a>
              ) : null}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ms-auto shrink-0"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden className="size-3.5" />
            {t("edit")}
          </Button>
        </div>
        {company.description ? (
          <p className="max-w-3xl text-sm">{company.description}</p>
        ) : null}
        {company.whyItMatters ? (
          <p className="max-w-3xl text-sm">
            <span className="font-medium">{t("whyItMatters")}: </span>
            {company.whyItMatters}
          </p>
        ) : null}
        <Relationship detail={detail.data} />
        <Plans detail={detail.data} onOpenContact={onOpenContact} />
      </div>
      {editing ? (
        <EditCompanyDialog
          company={company}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </section>
  );
}

function Relationship({ detail }: { detail: ContactCompanyDetail }) {
  const t = useTranslations("App.Contacts.company");
  const format = useFormatter();
  const { company } = detail;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
      <Stat label={t("people")}>
        <span className="tabular-nums">{company.people}</span>
      </Stat>
      <Stat label={t("knownBy")}>
        {detail.teammates.length ? (
          <AvatarStack
            label={t("knownByLabel", { count: detail.teammates.length })}
            people={detail.teammates.map((teammate) => ({
              id: teammate.id,
              name: teammate.name,
              image: null,
            }))}
          />
        ) : (
          <span className="text-muted-foreground">{t("nobody")}</span>
        )}
      </Stat>
      <Stat label={t("lastContact")}>
        {company.lastContactAt
          ? format.relativeTime(new Date(company.lastContactAt), new Date())
          : t("never")}
      </Stat>
      <Stat label={t("warmth")}>
        <span className="inline-flex items-center gap-1.5">
          <Dot className={WARMTH_DOT[company.warmth]} />
          {t(`warmthLevels.${company.warmth}`)}
        </span>
      </Stat>
      <Stat label={t("strongestStage")}>
        {company.strongestStage ? (
          <StageChip stage={company.strongestStage} />
        ) : (
          "—"
        )}
      </Stat>
    </dl>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="flex min-h-6 items-center">{children}</dd>
    </div>
  );
}

const SHOWN = 5;

function Plans({
  detail,
  onOpenContact,
}: {
  detail: ContactCompanyDetail;
  onOpenContact: (contactId: string) => void;
}) {
  const t = useTranslations("App.Contacts.company");
  const format = useFormatter();
  const names = new Map(
    detail.people.map((person) => [person.id, person.name]),
  );
  if (!detail.nextSteps.length && !detail.recentInteractions.length)
    return null;
  return (
    <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
      <div className="grid content-start gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">
          {t("nextSteps")}
        </h3>
        {detail.nextSteps.length ? (
          <ul className="grid gap-1.5 text-sm">
            {detail.nextSteps.slice(0, SHOWN).map((step) => (
              <li key={step.contactId} className="min-w-0 truncate">
                <button
                  type="button"
                  className="font-medium underline-offset-4 hover:underline"
                  onClick={() => onOpenContact(step.contactId)}
                >
                  {step.name}
                </button>
                <span className="text-muted-foreground">
                  {" · "}
                  {[
                    step.nextStep,
                    step.followUpAt
                      ? format.dateTime(new Date(step.followUpAt), {
                          day: "numeric",
                          month: "short",
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noNextSteps")}</p>
        )}
      </div>
      <div className="grid content-start gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">
          {t("recent")}
        </h3>
        {detail.recentInteractions.length ? (
          <ul className="grid gap-1.5 text-sm">
            {detail.recentInteractions.slice(0, SHOWN).map((touch) => (
              <li key={touch.id} className="flex min-w-0 gap-2">
                <span className="text-muted-foreground w-20 shrink-0 tabular-nums">
                  {format.dateTime(new Date(touch.occurredAt), {
                    day: "numeric",
                    month: "short",
                    year: "2-digit",
                  })}
                </span>
                <span className="min-w-0 truncate">
                  <button
                    type="button"
                    className="font-medium underline-offset-4 hover:underline"
                    onClick={() => onOpenContact(touch.contactId)}
                  >
                    {names.get(touch.contactId) ?? t("someone")}
                  </button>
                  <span className="text-muted-foreground">
                    {" · "}
                    {touch.summary}
                    {touch.user ? ` · ${touch.user.name}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noRecent")}</p>
        )}
      </div>
    </div>
  );
}

const FIELDS = [
  "name",
  "website",
  "industry",
  "size",
  "headquarters",
  "linkedinUrl",
  "description",
  "whyItMatters",
] as const;
type Field = (typeof FIELDS)[number];
const LONG: ReadonlySet<Field> = new Set(["description", "whyItMatters"]);

function EditCompanyDialog({
  company: current,
  onClose,
}: {
  company: ContactCompany;
  onClose: () => void;
}) {
  const t = useTranslations("App.Contacts.company");
  const cache = useQueryClient();
  // The company as the dialog opened: a refetch while editing must not move
  // the version under the reader's edits, or theirs would win silently.
  const [company] = useState(current);
  const [values, setValues] = useState<Record<Field, string>>(
    () =>
      Object.fromEntries(
        FIELDS.map((field) => [field, company[field] ?? ""]),
      ) as Record<Field, string>,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!values.name.trim()) return setError(t("nameRequired"));
    setPending(true);
    setError(null);
    try {
      const changed = Object.fromEntries(
        FIELDS.filter(
          (field) => values[field].trim() !== (company[field] ?? ""),
        ).map((field) => [field, values[field].trim() || null]),
      );
      await contactsService.updateCompany(company.id, {
        version: company.version,
        ...changed,
        name: values.name.trim(),
      });
      await cache.invalidateQueries({ queryKey: CONTACT_COMPANY_KEY });
      onClose();
    } catch (caught) {
      setError(coreErrorOf(caught).message ?? t("saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("editTitle")}</DialogTitle>
            <DialogDescription>{t("editDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <div
                key={field}
                className={cn("grid gap-2", LONG.has(field) && "sm:col-span-2")}
              >
                <Label htmlFor={`company-${field}`}>
                  {t(`fields.${field}`)}
                </Label>
                {LONG.has(field) ? (
                  <Textarea
                    id={`company-${field}`}
                    value={values[field]}
                    rows={field === "description" ? 3 : 2}
                    maxLength={field === "description" ? 2_000 : 1_000}
                    onChange={(event) =>
                      setValues({ ...values, [field]: event.target.value })
                    }
                  />
                ) : (
                  <Input
                    id={`company-${field}`}
                    value={values[field]}
                    maxLength={
                      field === "website" || field === "linkedinUrl" ? 500 : 200
                    }
                    autoComplete="off"
                    onChange={(event) =>
                      setValues({ ...values, [field]: event.target.value })
                    }
                  />
                )}
              </div>
            ))}
          </div>
          {error ? (
            <p role="alert" className="text-foreground text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
