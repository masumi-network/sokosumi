"use client";
import type {
  ContactSuggestion,
  FundraisingPipeline,
  FundraisingResearch,
} from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, UserSearch } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { ContactAvatar } from "@/app/contacts/components/contact-visuals";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fundraisingService } from "@/lib/services/fundraising.client";
import { useScopedQuery } from "@/queries/scoped-queries";
import {
  FUNDRAISING_KEY,
  useFundraisingOrganization,
} from "../use-fundraising";

const SIZES = [10, 25] as const;
type Size = (typeof SIZES)[number];
const SUGGESTIONS_KEY = ["fundraising-suggestions"] as const;
const SHOWN = 6;

export function useInvestorSuggestions() {
  const organizationId = useFundraisingOrganization();
  return useScopedQuery({
    scope: organizationId,
    queryKey: SUGGESTIONS_KEY,
    queryFn: () => fundraisingService.suggestions(),
    enabled: organizationId !== null,
  });
}

/**
 * Investors Exa found for the raise, waiting to be added or dismissed, and
 * the search that finds more. Nothing here is a contact until it is added.
 */
export function FindInvestors({ pipeline }: { pipeline: FundraisingPipeline }) {
  const t = useTranslations("App.Fundraising.find");
  const format = useFormatter();
  const cache = useQueryClient();
  const organizationId = useFundraisingOrganization();
  const suggestions = useInvestorSuggestions();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string[]>([]);
  const [research, setResearch] = useState<FundraisingResearch>(
    pipeline.research,
  );
  const rows = suggestions.data ?? [];
  const shown = expanded ? rows : rows.slice(0, SHOWN);
  const key = [organizationId, ...SUGGESTIONS_KEY] as const;

  async function decide(action: "add" | "dismiss", ids: string[]) {
    setBusy((current) => [...current, ...ids]);
    const hide = () =>
      cache.setQueryData<ContactSuggestion[]>(key, (current) =>
        current?.filter((row) => !ids.includes(row.id)),
      );
    void cache.cancelQueries({ queryKey: key });
    hide();
    try {
      if (action === "add") {
        const { added } = await fundraisingService.addSuggestions(ids);
        toast.success(t("added", { count: added }));
        void cache.invalidateQueries({
          queryKey: [organizationId, ...FUNDRAISING_KEY],
        });
      } else {
        await fundraisingService.dismissSuggestions(ids);
      }
      hide();
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("decideFailed"));
      await cache.invalidateQueries({ queryKey: key });
    } finally {
      setBusy((current) => current.filter((id) => !ids.includes(id)));
    }
  }

  const money = (value: number) =>
    format.number(value, { style: "currency", currency: "USD" });

  return (
    <section
      aria-label={t("title")}
      className="border-border-tertiary flex flex-col gap-3 rounded-xl border p-3"
      data-testid="find-investors"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">
          {rows.length ? t("titleCount", { count: rows.length }) : t("title")}
        </h3>
        <p className="text-muted-foreground truncate text-sm">
          {rows.length
            ? t("hintSuggested")
            : research.exaConfigured
              ? t("hint")
              : t("hintNoExa")}
        </p>
        <div className="ms-auto flex items-center gap-1">
          {rows.length > 1 ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy.length > 0}
              onClick={() =>
                void decide(
                  "add",
                  rows.map((row) => row.id),
                )
              }
            >
              {t("addAll")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={!research.exaConfigured}
            onClick={() => setOpen(true)}
          >
            <UserSearch aria-hidden className="size-4" />
            {t("find")}
          </Button>
        </div>
      </div>
      {rows.length ? (
        <ul className="divide-border-tertiary divide-y">
          {shown.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2"
              data-testid="investor-suggestion"
            >
              <ContactAvatar name={row.name} className="mt-0.5 size-8" />
              {/* basis-48: on a phone the buttons wrap below instead of squeezing the reason to one word per line. */}
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-medium">
                  {row.name}
                  <span className="text-muted-foreground font-normal">
                    {[row.role, row.organization].filter(Boolean).length
                      ? ` · ${[row.role, row.organization].filter(Boolean).join(", ")}`
                      : ""}
                    {row.location ? ` · ${row.location}` : ""}
                  </span>
                </p>
                <p className="text-muted-foreground text-sm text-pretty">
                  {row.reason}
                </p>
                <a
                  href={row.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                >
                  {new URL(row.profileUrl).hostname.replace(/^www\./, "")}
                  <ExternalLink aria-hidden className="size-3" />
                </a>
              </div>
              <div className="ms-auto flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy.includes(row.id)}
                  onClick={() => void decide("dismiss", [row.id])}
                >
                  {t("dismiss")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy.includes(row.id)}
                  onClick={() => void decide("add", [row.id])}
                >
                  {t("add")}
                </Button>
              </div>
            </li>
          ))}
          {rows.length > SHOWN ? (
            <li>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded
                  ? t("showFewer")
                  : t("showMore", { count: rows.length - SHOWN })}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
      <FindInvestorsDialog
        open={open}
        research={research}
        initialBrief=""
        onOpenChange={setOpen}
        onFound={(result) => {
          setResearch(result.research);
          void cache.invalidateQueries({ queryKey: key });
          toast.success(
            result.found
              ? t("found", { count: result.found, cost: money(result.costUsd) })
              : t("foundNobody", { cost: money(result.costUsd) }),
          );
        }}
      />
    </section>
  );
}

function FindInvestorsDialog({
  open,
  research,
  initialBrief,
  onOpenChange,
  onFound,
}: {
  open: boolean;
  research: FundraisingResearch;
  initialBrief: string;
  onOpenChange: (open: boolean) => void;
  onFound: (result: {
    found: number;
    costUsd: number;
    research: FundraisingResearch;
  }) => void;
}) {
  const t = useTranslations("App.Fundraising.find");
  const format = useFormatter();
  const [brief, setBrief] = useState(initialBrief);
  const [size, setSize] = useState<Size>(10);
  const [running, setRunning] = useState(false);
  const money = (value: number) =>
    format.number(value, { style: "currency", currency: "USD" });
  const left = Math.max(0, research.capUsd - research.monthUsd);
  const overCap = left < research.perSearchUsd;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (brief.trim().length < 10 || running) return;
    setRunning(true);
    try {
      const result = await fundraisingService.find({
        brief: brief.trim(),
        size,
      });
      onFound(result);
      onOpenChange(false);
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("failed"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="fundraising-brief">{t("briefLabel")}</Label>
            <Textarea
              id="fundraising-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={t("briefPlaceholder")}
              rows={5}
              maxLength={1500}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("sizeLabel")}</Label>
            <ToggleGroup
              type="single"
              value={String(size)}
              onValueChange={(value) => {
                const next = SIZES.find((s) => String(s) === value);
                if (next) setSize(next);
              }}
              className="justify-start"
            >
              {SIZES.map((option) => (
                <ToggleGroupItem key={option} value={String(option)}>
                  {t("size", { count: option })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <p className="text-muted-foreground text-sm" data-testid="find-cost">
            {t("cost", {
              perSearch: money(research.perSearchUsd),
              spent: money(research.monthUsd),
              cap: money(research.capUsd),
            })}
          </p>
          {overCap ? (
            <p className="text-destructive text-sm">{t("capReached")}</p>
          ) : null}
          {running ? (
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {t("running")}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={running}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              loading={running}
              disabled={overCap || brief.trim().length < 10}
            >
              {t("run", { cost: money(research.perSearchUsd) })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
