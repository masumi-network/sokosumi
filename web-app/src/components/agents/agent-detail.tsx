import {
  AgentListWithAgent,
  AgentWithRelations,
  CreditsPrice,
  getAgentExampleOutput,
  getAgentLegal,
  JobWithRelations,
} from "@/lib/db";

import {
  AgentDetailSection1,
  AgentDetailSection1Skeleton,
  AgentDetailSection2,
  AgentDetailSection2Skeleton,
  AgentDetailSection3,
  AgentDetailSection3Skeleton,
  AgentDetailSection4,
  AgentDetailSection4Skeleton,
  AgentDetailSection5,
  AgentDetailSection5Skeleton,
} from "./details";

interface AgentDetailProps {
  agent: AgentWithRelations;
  agentCreditsPrice: CreditsPrice;
  jobs: JobWithRelations[];
  agentList?: AgentListWithAgent | undefined;
}

function AgentDetail({
  agent,
  agentCreditsPrice,
  jobs,
  agentList,
}: AgentDetailProps) {
  const exampleOutputs = getAgentExampleOutput(agent);
  const legal = getAgentLegal(agent);

  return (
    <div className="flex flex-col gap-2">
      <SectionWrapper>
        <AgentDetailSection1
          agent={agent}
          agentCreditsPrice={agentCreditsPrice}
          agentList={agentList}
        />
      </SectionWrapper>
      <SectionWrapper>
        <AgentDetailSection2 agent={agent} jobs={jobs} />
      </SectionWrapper>
      <SectionWrapper>
        <AgentDetailSection3 agent={agent} />
      </SectionWrapper>
      {exampleOutputs.length > 0 && (
        <SectionWrapper>
          <AgentDetailSection4 exampleOutputs={exampleOutputs} />
        </SectionWrapper>
      )}
      {legal && (
        <SectionWrapper>
          <AgentDetailSection5 legal={legal} />
        </SectionWrapper>
      )}
    </div>
  );
}

function AgentDetailSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <SectionWrapper>
        <AgentDetailSection1Skeleton />
      </SectionWrapper>
      <SectionWrapper>
        <AgentDetailSection2Skeleton />
      </SectionWrapper>
      <SectionWrapper>
        <AgentDetailSection3Skeleton />
      </SectionWrapper>
      <SectionWrapper>
        <AgentDetailSection4Skeleton />
      </SectionWrapper>
      <SectionWrapper>
        <AgentDetailSection5Skeleton />
      </SectionWrapper>
    </div>
  );
}
function SectionWrapper({ children }: { children: React.ReactNode }) {
  return <div className="p-2">{children}</div>;
}

export { AgentDetail, AgentDetailSkeleton };
