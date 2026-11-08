"use client";

import type { ContactStage } from "@sokosumi/core-client";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { STAGE_DOT } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import type { ContactQuery } from "@/lib/services/contacts.client";
import { cn } from "@/lib/utils";
import { Dot } from "./contact-visuals";
import { useContactBreakdown } from "./use-contacts-data";

type Breakdown = NonNullable<
  ReturnType<typeof useContactBreakdown>["data"]
>["breakdowns"][number];

/** Not contacted for 90 days or more, or never. */
const QUIET = new Set(["365d", "older", null]);

/**
 * Who is on a list at a glance: how they split by stage, company, place and
 * teammate, and how many nobody has been in touch with for 90 days.
 */
export function ListOverview({
  query,
  onShowMap,
  onCompany,
}: {
  query: ContactQuery;
  onShowMap: () => void;
  onCompany: (name: string) => void;
}) {
  const t = useTranslations("App.Contacts.overview");
  const stages = useTranslations("App.Contacts.stages");
  const breakdown = useContactBreakdown(query, true);
  const data = breakdown.data;
  if (!data || data.total === 0) return null;
  const by = (key: Breakdown["by"]) =>
    data.breakdowns.find((each) => each.by === key);
  const quiet =
    by("lastContact")?.groups.reduce(
      (sum, group) => sum + (QUIET.has(group.key) ? group.count : 0),
      0,
    ) ?? 0;
  return (
    <section aria-label={t("label")} className={HOLDER_CLASS}>
      <div className={cn(HOLDER_ITEM_CLASS, "grid gap-4 p-4")}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="font-medium tabular-nums">
            {t("people", { count: data.total })}
          </span>
          {quiet > 0 ? (
            <span className="text-muted-foreground tabular-nums">
              {t("quiet", { count: quiet })}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="ms-auto"
            onClick={onShowMap}
          >
            <Globe aria-hidden className="size-3.5" />
            {t("map")}
          </Button>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Groups
            label={t("stages")}
            breakdown={by("stage")}
            render={(group) => (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Dot className={STAGE_DOT[group.key as ContactStage]} />
                <span className="truncate">
                  {stages(group.key as ContactStage)}
                </span>
              </span>
            )}
          />
          <Groups
            label={t("companies")}
            breakdown={by("organization")}
            render={(group) =>
              group.key === null ? (
                <span className="text-muted-foreground">{t("none")}</span>
              ) : (
                <button
                  type="button"
                  className="truncate underline-offset-4 hover:underline"
                  onClick={() => onCompany(group.label)}
                >
                  {group.label}
                </button>
              )
            }
          />
          <Groups
            label={t("places")}
            breakdown={by("location")}
            render={(group) => (
              <span
                className={cn(
                  "truncate",
                  group.key === null && "text-muted-foreground",
                )}
              >
                {group.key === null ? t("none") : group.label}
              </span>
            )}
          />
          <Groups
            label={t("knownBy")}
            breakdown={by("knownBy")}
            render={(group) => <span className="truncate">{group.label}</span>}
          />
        </dl>
      </div>
    </section>
  );
}

function Groups({
  label,
  breakdown,
  render,
}: {
  label: string;
  breakdown: Breakdown | undefined;
  render: (group: Breakdown["groups"][number]) => React.ReactNode;
}) {
  const t = useTranslations("App.Contacts.overview");
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      {breakdown?.groups.length ? (
        <>
          {breakdown.groups.map((group) => (
            <dd
              key={group.key ?? "none"}
              className="flex min-w-0 items-center justify-between gap-3"
            >
              {render(group)}
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {group.count}
              </span>
            </dd>
          ))}
          {breakdown.otherGroups > 0 ? (
            <dd className="text-muted-foreground text-xs">
              {t("more", { count: breakdown.otherGroups })}
            </dd>
          ) : null}
        </>
      ) : (
        <dd className="text-muted-foreground">{t("nobody")}</dd>
      )}
    </div>
  );
}
