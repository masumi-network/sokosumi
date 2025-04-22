import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentListWithAgent,
  AgentWithRelations,
  convertCentsToCredits,
  CreditsPrice,
  getAgentAuthorName,
  getAgentDescription,
  getAgentExampleOutput,
  getAgentLegal,
  getAgentName,
  getAgentResolvedImage,
  getAgentTags,
} from "@/lib/db";
import { cn } from "@/lib/utils";

import ActionButtons from "./action-buttons";
import { BadgeCloud } from "./badge-cloud";

interface AgentDetailSkeletonProps {
  className?: string;
}

function AgentDetailSkeleton({ className }: AgentDetailSkeletonProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {/* Agent Summary */}
      <div className="flex h-48 w-full overflow-hidden">
        <div className="relative h-full w-48">
          <Skeleton className="h-full w-full rounded-md" />
        </div>
        <div className="flex flex-1 flex-col px-6 py-2">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="mt-1 h-5 w-32" />
            <Skeleton className="mt-1 h-5 w-24" />
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
            </div>
          </div>
        </div>
      </div>

      {/* Badge Cloud */}
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((index) => (
          <Skeleton key={index} className="h-6 w-16 rounded-full" />
        ))}
      </div>

      {/* Description */}
      <div className="text-muted-foreground">
        <Skeleton className="h-4 w-full max-w-3xl" />
        <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
        <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
      </div>

      {/* Example Output */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[1, 2, 3].map((index) => (
          <Skeleton
            key={index}
            className="h-64 w-auto flex-shrink-0 rounded-lg"
          />
        ))}
      </div>

      {/* Legal Links */}
      <div className="text-muted-foreground flex flex-wrap gap-6 text-sm">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
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
  const exampleOutput = getAgentExampleOutput(agent);
  const description = getAgentDescription(agent);

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-8 xl:px-16">
      <ActionButtons agentId={agent.id} agentList={agentList} />
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
        <div className="flex h-48 flex-1 flex-col justify-between p-2 sm:px-6">
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
      <div className="space-y-6">
        {/* Description Section */}
        <div>
          <h3 className="mb-3 text-xs tracking-wide uppercase">
            {t("description")}
          </h3>
          <p className="text-muted-foreground">{description}</p>
        </div>

        {/* At a Glance Section */}
        <div>
          <h3 className="mb-3 text-xs tracking-wide uppercase">
            {t("atAGlance")}
          </h3>
          <div className="flex flex-wrap gap-2">
            <BadgeCloud tags={getAgentTags(agent)} />
          </div>
        </div>
      </div>

      {/* Example Output */}
      <ScrollArea>
        <div className="flex gap-4 pb-4">
          {exampleOutput.map((_, index) => (
            <Image
              key={index}
              src="/placeholder.svg"
              alt={`Placeholder ${index + 1}`}
              className="h-64 w-64 flex-shrink-0 rounded-lg object-cover"
              width={256}
              height={256}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Developer Information */}
      <div className="text-muted-foreground flex gap-6 text-sm">
        {legal && <p>{t("Legal.fromDeveloper")}</p>}
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
      </div>
    </div>
  );
}

export { AgentDetails, AgentDetailSkeleton };
