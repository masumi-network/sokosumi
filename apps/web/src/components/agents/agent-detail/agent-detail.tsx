import type { AgentReview } from "@sokosumi/core-client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { AgentBadgeCloud } from "@/components/agents/agent-badge-cloud";
import { AgentIcon } from "@/components/agents/agent-icon";
import {
  AboutList,
  AgentProfile,
  AgentProfileSkeleton,
} from "@/components/agents/directory/agent-profile";
import { AGENTS_CARD_CLASS } from "@/components/agents/directory/agents-page-classes";
import { RiskClassificationBadge } from "@/components/agents/risk-classification-badge";
import { ExpandableMarkdown } from "@/components/expandable-markdown";
import {
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import {
  getAgentDescription,
  getAgentExampleOutputs,
  getAgentLegal,
  getAgentName,
  getAgentResolvedIcon,
  getAgentTags,
  getFullAgentAuthorName,
} from "@/lib/helpers/agent";
import type { AgentRatingStats, CoreAgentDto } from "@/lib/types/core-dto";
import { isCoreAgentDetail } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/duration";

import { AgentDetailExamples } from "./examples/examples";
import { MarketplaceAgentActions } from "./marketplace-agent-actions";
import { AgentDetailReviews } from "./reviews";

interface AgentDetailProps {
  agent: CoreAgentDto;
  executedJobsCount: number;
  averageExecutionDuration: number | null;
  ratingStats: AgentRatingStats;
  ratingDistribution?: Record<number, number> | undefined;
  ratingsWithComments?: AgentReview[] | undefined;
  canRate?: boolean | undefined;
  existingRating?: { rating: number; comment: string | null } | null;
  /** Viewer's jobs with this agent; Recent work links to them. */
  myJobsCount?: number | undefined;
}

const LINK_CLASS =
  "text-foreground underline underline-offset-2 hover:no-underline";

type AgentLegal = ReturnType<typeof getAgentLegal>;

function LegalLinks({ legal }: { legal: AgentLegal }) {
  const t = useTranslations("Components.Agents.AgentDetail.Legal");
  const links = [
    { href: legal?.terms, label: t("terms") },
    { href: legal?.privacyPolicy, label: t("privacyPolicy") },
    { href: legal?.dpa, label: t("dpa") },
    { href: legal?.other, label: t("other") },
  ].filter((link) => Boolean(link.href));
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href ?? undefined}
          target="_blank"
          rel="noreferrer noopener"
          className={LINK_CLASS}
        >
          {link.label}
        </a>
      ))}
    </span>
  );
}

function hasLegalLinks(legal: AgentLegal): boolean {
  return Boolean(
    legal?.terms || legal?.privacyPolicy || legal?.dpa || legal?.other,
  );
}

/** Facts about a marketplace agent: who makes it, how it has run, its terms. */
function MarketplaceAbout({
  agent,
  vendor,
  executedJobsCount,
  averageExecutionDuration,
}: {
  agent: CoreAgentDto;
  vendor: string | null;
  executedJobsCount: number;
  averageExecutionDuration: number | null;
}) {
  const t = useTranslations("App.Agents.Directory");
  const tLegal = useTranslations("Components.Agents.AgentDetail.Legal");
  const tDuration = useTranslations("Library.Duration.Long");
  const format = useFormatter();
  const legal = getAgentLegal(agent);
  const rows = [
    vendor ? { label: t("aboutMadeBy"), value: vendor } : null,
    { label: t("aboutSource"), value: t("aboutSourceExternal") },
    {
      label: t("aboutRuns"),
      value: format.number(executedJobsCount, { notation: "compact" }),
    },
    averageExecutionDuration && averageExecutionDuration > 0
      ? {
          label: t("aboutAverageTime"),
          value: formatDuration(averageExecutionDuration, tDuration),
        }
      : null,
    isCoreAgentDetail(agent)
      ? {
          label: t("aboutRisk"),
          value: (
            <RiskClassificationBadge
              riskClassification={agent.riskClassification}
            />
          ),
        }
      : null,
    hasLegalLinks(legal)
      ? { label: tLegal("title"), value: <LegalLinks legal={legal} /> }
      : null,
  ].filter((row) => row !== null);
  return <AboutList rows={rows} />;
}

/** A marketplace agent's profile, in the layout every agent shares. */
export function AgentDetail({
  agent,
  executedJobsCount,
  averageExecutionDuration,
  ratingStats,
  ratingDistribution,
  ratingsWithComments,
  canRate = false,
  existingRating = null,
  myJobsCount = 0,
}: AgentDetailProps) {
  const t = useTranslations("App.Agents.Directory");
  const tTaskDetail = useTranslations("App.Tasks.Detail");
  const name = getAgentName(agent);
  const vendor = getFullAgentAuthorName(agent);
  const description = getAgentDescription(agent);
  const tags = getAgentTags(agent);
  const examples = getAgentExampleOutputs(agent);

  return (
    <AgentProfile
      backLabel={t("backToAgents")}
      avatar={
        <span className="border-border bg-card-background flex size-12 items-center justify-center rounded-xl border">
          <AgentIcon
            agent={{ name, icon: getAgentResolvedIcon(agent) }}
            className="size-6"
          />
        </span>
      }
      name={name}
      tag={t("external")}
      byline={vendor ? t("byVendor", { vendor }) : t("aboutSourceExternal")}
      actions={<MarketplaceAgentActions agentId={agent.id} />}
      sections={[
        {
          id: "what",
          title: t("sectionWhat"),
          content: (
            <>
              {description || tags.length > 0 ? (
                <div className={cn(AGENTS_CARD_CLASS, "flex flex-col gap-4")}>
                  {description ? (
                    <ExpandableMarkdown
                      content={description}
                      className="text-foreground max-w-prose"
                      expandLabel={tTaskDetail("expand")}
                      collapseLabel={tTaskDetail("collapse")}
                      fadeClassName="to-background"
                    />
                  ) : null}
                  {tags.length > 0 ? <AgentBadgeCloud tags={tags} /> : null}
                </div>
              ) : null}
              {examples.length > 0 ? (
                <AgentDetailExamples exampleOutputs={examples} />
              ) : null}
            </>
          ),
        },
        myJobsCount > 0 && {
          id: "work",
          title: t("sectionWork"),
          content: (
            <Link
              href={`/agents/${agent.id}/jobs`}
              className={cn(
                HOLDER_ITEM_CLASS,
                HOLDER_ITEM_HOVER_CLASS,
                "focus-visible:ring-ring flex items-center justify-between gap-3 px-4 py-3 text-sm outline-none focus-visible:ring-2",
              )}
            >
              <span className="text-foreground font-medium">
                {t("yourJobs", { count: myJobsCount })}
              </span>
              <ChevronRight
                aria-hidden
                className="text-muted-foreground size-4"
              />
            </Link>
          ),
        },
        {
          id: "about",
          title: t("sectionAbout"),
          content: (
            <>
              <MarketplaceAbout
                agent={agent}
                vendor={vendor}
                executedJobsCount={executedJobsCount}
                averageExecutionDuration={averageExecutionDuration}
              />
              {ratingStats.total > 0 || canRate ? (
                <AgentDetailReviews
                  agentId={agent.id}
                  ratingStats={ratingStats}
                  distribution={ratingDistribution ?? {}}
                  ratingsWithComments={ratingsWithComments ?? []}
                  canRate={canRate}
                  existingRating={existingRating}
                />
              ) : null}
            </>
          ),
        },
      ]}
    />
  );
}

/** Route-level Instant shell — sync only (no session/i18n/cookies). */
export function AgentDetailPageSkeleton() {
  return <AgentProfileSkeleton />;
}
