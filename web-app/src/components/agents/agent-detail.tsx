import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentListWithAgent,
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentAuthorName,
  getAgentDescription,
  getAgentLegal,
  getAgentName,
  getAgentResolvedImage,
  getAgentTags,
} from "@/lib/db";
import { cn } from "@/lib/utils";

import AgentActionButtons from "./agent-action-buttons";
import { BadgeCloud } from "./badge-cloud";

interface AgentDetailSkeletonProps {
  className?: string;
}

function AgentDetailSkeleton({ className }: AgentDetailSkeletonProps) {
  return (
    <div className={cn("w-full space-y-6 px-20 py-6", className)}>
      {/* Action Buttons */}
      <div className="flex justify-end gap-2">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
      </div>

      {/* Agent Summary */}
      <div className="flex w-full flex-col gap-y-4 sm:flex-row">
        <div className="relative mx-auto h-48 w-48">
          <Skeleton className="h-full w-full rounded-md" />
        </div>
        <div className="flex h-48 flex-1 flex-col justify-between pl-4">
          <div>
            <Skeleton className="h-9 w-48" />
            <div className="mt-2">
              <Skeleton className="h-9 w-64" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-10 w-24" />
          </div>
        </div>
      </div>

      {/* Description and Tags Sections */}
      <div className="space-y-10">
        {/* Description Section */}
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>

        {/* At a Glance Section */}
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} className="h-6 w-16 rounded-full" />
            ))}
          </div>
        </div>

        {/* Legal Section */}
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <div className="flex gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface AgentDetailsProps {
  agent: AgentWithRelations;
  agentList?: AgentListWithAgent | undefined;
  agentCreditsPrice: CreditsPrice;
  className?: string;
}

function AgentDetails({
  agent,
  agentList,
  agentCreditsPrice,
}: AgentDetailsProps) {
  const t = useTranslations("Components.Agents.AgentDetail");

  const legal = getAgentLegal(agent);
  const description = getAgentDescription(agent);

  return (
    <div className="w-full space-y-6 px-20 py-6">
      <AgentActionButtons agentId={agent.id} agentList={agentList} />
      {/* Agent Summary */}
      <div className="flex w-full flex-col gap-y-4 sm:flex-row">
        <div className="relative mx-auto h-48 w-48">
          <Image
            src={getAgentResolvedImage(agent)}
            alt={getAgentName(agent)}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="rounded-md object-cover"
            priority
          />
        </div>
        <div className="flex h-48 flex-1 flex-col justify-between pl-4">
          {/* Title and Bookmark Button Container */}
          <div>
            <h2 className="text-3xl font-light">{getAgentName(agent)}</h2>
            <div className="text-muted-foreground line-clamp-3">
              <div className="text-muted-foreground text-3xl font-light">
                {t("byAuthor", { author: getAgentAuthorName(agent) })}
              </div>
            </div>
          </div>
          {/* Pricing and Hire Button */}
          <div className="flex items-center justify-between gap-4">
            <div className="text-base">
              <span className="font-medium">
                {t("pricing", {
                  credits: convertCentsToCredits(agentCreditsPrice.cents),
                })}
              </span>
            </div>
            <div className="flex gap-2">
              <Link href={`/app/agents/${agent.id}/jobs`}>
                <Button size="lg">{t("hire")}</Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Description and Tags Sections */}
      <div className="space-y-10">
        {/* Description Section */}
        {description && (
          <Section title={t("description")}>{description}</Section>
        )}

        {/* At a Glance Section */}
        <Section title={t("atAGlance")}>
          <BadgeCloud tags={getAgentTags(agent)} />
        </Section>

        {/* Developer Information */}
        {legal && (
          <Section title={t("Legal.fromDeveloper")}>
            {legal?.privacyPolicy && (
              <Link
                href={legal.privacyPolicy}
                className="hover:text-foreground underline underline-offset-4 transition-colors"
              >
                {t("Legal.privacyPolicy")}
              </Link>
            )}
            {legal?.terms && (
              <Link
                href={legal.terms}
                className="hover:text-foreground underline underline-offset-4 transition-colors"
              >
                {t("Legal.terms")}
              </Link>
            )}
            {legal?.other && (
              <Link
                href={legal.other}
                className="hover:text-foreground underline underline-offset-4 transition-colors"
              >
                {t("Legal.other")}
              </Link>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs tracking-wide uppercase">{title}</h3>
      <div className="text-muted-foreground flex flex-wrap gap-4">
        {children}
      </div>
    </div>
  );
}

export { AgentDetails, AgentDetailSkeleton };
