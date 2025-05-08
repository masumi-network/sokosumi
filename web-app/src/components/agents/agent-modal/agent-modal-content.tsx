import { Link } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  AgentListWithAgent,
  AgentWithRelations,
  CreditsPrice,
  JobWithRelations,
} from "@/lib/db";

import {
  CardSection,
  CardSection1,
  CardSection1Skeleton,
  CardSection2,
  CardSection2Skeleton,
  CardSection3,
  CardSection3Skeleton,
  CardSection4,
  CardSection4Skeleton,
  CardSection5,
  CardSection5Skeleton,
} from "./card-sections";

interface AgentModalContentProps {
  agent: AgentWithRelations;
  agentCreditsPrice: CreditsPrice;
  jobs: JobWithRelations[];
  agentList?: AgentListWithAgent | undefined;
}

export function AgentModalContent({
  agent,
  agentCreditsPrice,
  jobs,
  agentList,
}: AgentModalContentProps) {
  return (
    <div className="flex w-[80vw] max-w-3xl! flex-col gap-1.5">
      <CardSection1
        agent={agent}
        agentList={agentList}
        agentCreditsPrice={agentCreditsPrice}
      />
      <CardSection2 agent={agent} jobs={jobs} />
      <CardSection3 agent={agent} />
      <CardSection4 agent={agent} />
      <CardSection5 agent={agent} />
    </div>
  );
}

export function AgentModalSkeleton() {
  return (
    <div className="flex w-[80vw] max-w-3xl! flex-col gap-1.5">
      <CardSection1Skeleton />
      <CardSection2Skeleton />
      <CardSection3Skeleton />
      <CardSection4Skeleton />
      <CardSection5Skeleton />
    </div>
  );
}

export function AgentModalError() {
  const t = useTranslations("Components.Agents.AgentModal");

  return (
    <div className="flex w-[80vw] max-w-3xl! flex-col gap-1.5">
      <CardSection>
        <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-red-300 bg-red-50 p-4">
          <span className="text-lg text-red-500">{t("error")}</span>
        </div>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/agents">{t("backToAgents")}</Link>
        </Button>
      </CardSection>
    </div>
  );
}
