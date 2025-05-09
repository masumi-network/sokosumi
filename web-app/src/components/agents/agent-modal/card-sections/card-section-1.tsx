import {
  AgentDetailSection1,
  AgentDetailSection1Skeleton,
} from "@/components/agents/details";
import { AgentListWithAgent, AgentWithRelations, CreditsPrice } from "@/lib/db";

import { CardSection } from "./card-section";

interface CardSection1Props {
  agent: AgentWithRelations;
  agentList: AgentListWithAgent | undefined;
  agentCreditsPrice: CreditsPrice;
  showBackButton?: boolean | undefined;
  showCloseButton?: boolean | undefined;
  onClose?: (() => void) | undefined;
}

function CardSection1({
  agent,
  agentList,
  agentCreditsPrice,
  showBackButton,
  showCloseButton,
  onClose,
}: CardSection1Props) {
  return (
    <CardSection>
      <AgentDetailSection1
        agent={agent}
        agentList={agentList}
        agentCreditsPrice={agentCreditsPrice}
        showBackButton={showBackButton}
        showCloseButton={showCloseButton}
        onClose={onClose}
      />
    </CardSection>
  );
}

function CardSection1Skeleton() {
  return (
    <CardSection>
      <AgentDetailSection1Skeleton />
    </CardSection>
  );
}

export { CardSection1, CardSection1Skeleton };
