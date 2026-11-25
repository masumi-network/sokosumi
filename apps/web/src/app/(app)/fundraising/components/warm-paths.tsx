"use client";
import type {
  FundraisingPath,
  FundraisingPaths,
  FundraisingProspect,
} from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  ContactAvatar,
  PersonAvatar,
} from "@/app/contacts/components/contact-visuals";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/auth.client";
import { fundraisingService } from "@/lib/services/fundraising.client";
import { cn } from "@/lib/utils";
import { useScopedQuery } from "@/queries/scoped-queries";
import {
  useFundraisingOrganization,
  useProspectUpdate,
} from "../use-fundraising";

const PATHS_SHOWN = 6;
const PORTFOLIO_SHOWN = 5;
export const pathsKey = (contactId: string) =>
  ["fundraising-paths", contactId] as const;

function StrengthBar({ value }: { value: number }) {
  return (
    <span
      aria-hidden
      className="bg-quinary inline-flex h-1 w-12 overflow-hidden rounded-full"
    >
      <span className="bg-foreground h-full" style={{ width: `${value}%` }} />
    </span>
  );
}

/**
 * How to reach one investor: the portfolio Exa found for their fund, and
 * the team's paths to them through people it already knows, strongest first.
 */
export function WarmPaths({
  prospect,
  now,
}: {
  prospect: FundraisingProspect;
  now: Date;
}) {
  const t = useTranslations("App.Fundraising.paths");
  const me = useSession().data?.user.id ?? null;
  const selfOf = (path: FundraisingPath) =>
    path.via && path.via.id !== me ? "no" : "yes";
  const whoOf = (path: FundraisingPath) => path.via?.name ?? "";
  const throughOf = (path: FundraisingPath) =>
    path.through
      ? path.through.role
        ? `${path.through.name} (${path.through.role})`
        : path.through.name
      : "";
  const format = useFormatter();
  const cache = useQueryClient();
  const organizationId = useFundraisingOrganization();
  const update = useProspectUpdate();
  const contactId = prospect.contact.id;
  const query = useScopedQuery({
    scope: organizationId,
    queryKey: pathsKey(contactId),
    queryFn: () => fundraisingService.paths(contactId),
    enabled: organizationId !== null,
  });
  const [researching, setResearching] = useState(false);
  const [allPaths, setAllPaths] = useState(false);
  const [allPortfolio, setAllPortfolio] = useState(false);
  const data = query.data;
  const money = (value: number) =>
    format.number(value, { style: "currency", currency: "USD" });

  async function research() {
    setResearching(true);
    try {
      const result = await fundraisingService.researchPortfolio(contactId);
      cache.setQueryData<FundraisingPaths>(
        [organizationId, ...pathsKey(contactId)],
        result,
      );
      toast.success(
        t("researched", {
          count: result.portfolio.length,
          cost: money(result.researchUsd),
        }),
      );
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("researchFailed"));
    } finally {
      setResearching(false);
    }
  }

  async function usePath(path: FundraisingPath) {
    const who = whoOf(path);
    const self = selfOf(path);
    const nextStep =
      path.kind === "direct"
        ? t("nextStepDirect", { self, who })
        : t("nextStepIntro", {
            self,
            who,
            through: path.through?.name ?? "",
            investor: prospect.contact.name,
          });
    const ok = await update.updateContact(prospect, { nextStep });
    if (ok && prospect.stage === "TO_RESEARCH")
      await update.updateProspect(prospect, { stage: "WARM_PATH" });
    if (ok) toast.success(t("pathUsed"));
  }

  const fundName = prospect.contact.organization;
  const canResearch =
    Boolean(fundName) && (data?.research.exaConfigured ?? false);
  const overCap = data
    ? data.research.monthUsd + data.researchUsd > data.research.capUsd
    : false;

  return (
    <div className="grid gap-4" data-testid="warm-paths">
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">
            {t("pathsTitle")}
          </span>
        </div>
        {query.isError ? (
          <p className="text-muted-foreground text-sm">{t("loadFailed")}</p>
        ) : !data ? (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        ) : data.paths.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            {data.portfolio.length ? t("noPathsYet") : t("noPathsNoPortfolio")}{" "}
            <Link href="/contacts" className="underline underline-offset-2">
              {t("importHint")}
            </Link>
          </p>
        ) : (
          <ul className="grid gap-2">
            {(allPaths ? data.paths : data.paths.slice(0, PATHS_SHOWN)).map(
              (path, index) => (
                <li
                  key={`${path.kind}-${path.via?.id ?? "nobody"}-${path.through?.id ?? "direct"}-${index}`}
                  className="flex items-start gap-2 text-sm"
                  data-testid="warm-path"
                >
                  {path.through ? (
                    <ContactAvatar
                      name={path.through.name}
                      src={path.through.avatarUrl}
                      email={path.through.email}
                      className="mt-0.5 size-7"
                    />
                  ) : path.via ? (
                    <PersonAvatar person={path.via} className="mt-0.5 size-7" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-pretty">
                      {path.kind === "direct"
                        ? t("direct", { self: selfOf(path), who: whoOf(path) })
                        : path.kind === "linkedin"
                          ? t("linkedinDirect", {
                              self: selfOf(path),
                              who: whoOf(path),
                            })
                          : path.via
                            ? t(
                                path.touches
                                  ? path.kind === "fund"
                                    ? "viaFund"
                                    : "viaPortfolio"
                                  : path.kind === "fund"
                                    ? "linkedinFund"
                                    : "linkedinPortfolio",
                                {
                                  self: selfOf(path),
                                  who: whoOf(path),
                                  through: throughOf(path),
                                  company: path.company?.name ?? "",
                                },
                              )
                            : t(
                                path.kind === "fund"
                                  ? "coldFund"
                                  : "coldPortfolio",
                                {
                                  through: throughOf(path),
                                  company: path.company?.name ?? "",
                                },
                              )}
                    </p>
                    <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                      <StrengthBar value={path.strength} />
                      <span>
                        {path.touches
                          ? t("touches", { count: path.touches })
                          : path.linkedIn
                            ? t("onLinkedIn")
                            : t("noTouches")}
                        {path.touches && path.linkedIn
                          ? ` · ${t("onLinkedIn")}`
                          : ""}
                        {path.lastTouchAt
                          ? ` · ${format.relativeTime(new Date(path.lastTouchAt), now)}`
                          : ""}
                        {path.company?.round
                          ? ` · ${[path.company.round, path.company.date].filter(Boolean).join(" ")}`
                          : ""}
                      </span>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => void usePath(path)}
                  >
                    {t("usePath")}
                  </Button>
                </li>
              ),
            )}
            {data.paths.length > PATHS_SHOWN ? (
              <li>
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-0"
                  onClick={() => setAllPaths((value) => !value)}
                >
                  {allPaths
                    ? t("showFewer")
                    : t("showMore", { count: data.paths.length - PATHS_SHOWN })}
                </Button>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs font-medium">
            {fundName
              ? t("portfolioTitle", { fund: fundName })
              : t("portfolioTitleNoFund")}
            {data?.researchedAt
              ? ` · ${t("researchedAt", {
                  when: format.relativeTime(new Date(data.researchedAt), now),
                })}`
              : ""}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0"
            loading={researching}
            disabled={!data || !canResearch || overCap}
            onClick={() => void research()}
            data-testid="research-portfolio"
          >
            {data?.portfolio.length
              ? t("researchAgain", { cost: money(data.researchUsd) })
              : t("research", { cost: money(data?.researchUsd ?? 0.1) })}
          </Button>
        </div>
        {data && !canResearch ? (
          <p className="text-muted-foreground text-xs">
            {fundName ? t("noExa") : t("noFund")}
          </p>
        ) : null}
        {overCap ? (
          <p className="text-muted-foreground text-xs">{t("capReached")}</p>
        ) : null}
        {data?.portfolio.length ? (
          <ul className="grid gap-1">
            {(allPortfolio
              ? data.portfolio
              : data.portfolio.slice(0, PORTFOLIO_SHOWN)
            ).map((company) => (
              <li
                key={company.id}
                className="flex items-baseline gap-2 text-sm"
                data-testid="portfolio-company"
              >
                <span className="min-w-0 truncate font-medium">
                  {company.name}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {[company.round, company.date].filter(Boolean).join(" · ")}
                </span>
                <a
                  href={company.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("source")}
                  className={cn(
                    "text-muted-foreground hover:text-foreground ms-auto shrink-0",
                  )}
                >
                  <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </li>
            ))}
            {data.portfolio.length > PORTFOLIO_SHOWN ? (
              <li>
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-0"
                  onClick={() => setAllPortfolio((value) => !value)}
                >
                  {allPortfolio
                    ? t("showFewer")
                    : t("showMore", {
                        count: data.portfolio.length - PORTFOLIO_SHOWN,
                      })}
                </Button>
              </li>
            ) : null}
          </ul>
        ) : data ? (
          <p className="text-muted-foreground text-sm">
            {researching ? t("researching") : t("noPortfolio")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
