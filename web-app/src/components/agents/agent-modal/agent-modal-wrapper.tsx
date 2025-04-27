"use client";

import { notFound } from "next/navigation";
import { useQueryState } from "nuqs";
import { Suspense } from "react";

import { AgentListWithAgent, AgentWithRelations, CreditsPrice } from "@/lib/db";

import { AgentModal } from "./agent-modal";

function findAgentAndAgentCreditsPrice(
  agents: AgentWithRelations[],
  agentCreditsPriceList: CreditsPrice[],
  agentId: string,
): [AgentWithRelations, CreditsPrice] | undefined {
  const foundIndex = agents.findIndex((agent) => agent.id === agentId);

  if (
    foundIndex < 0 ||
    !agents[foundIndex] ||
    !agentCreditsPriceList[foundIndex]
  ) {
    return undefined;
  }

  return [agents[foundIndex], agentCreditsPriceList[foundIndex]];
}

interface AgentModalWrapperProps {
  agents: AgentWithRelations[];
  agentList?: AgentListWithAgent | undefined;
  agentCreditsPriceList: CreditsPrice[];
}

function AgentModalWrapper(props: AgentModalWrapperProps) {
  return (
    <Suspense>
      <AgentModalWrapperClient {...props} />
    </Suspense>
  );
}

function AgentModalWrapperClient({
  agents,
  agentList,
  agentCreditsPriceList,
}: AgentModalWrapperProps) {
  const [modalAgentId, setModalAgentId] = useQueryState("modalAgentId");

  if (!modalAgentId) {
    return null;
  }

  const found = findAgentAndAgentCreditsPrice(
    agents,
    agentCreditsPriceList,
    modalAgentId,
  );

  if (!found) {
    return notFound();
  }

  const [agent, agentCreditsPrice] = found;

  const onCloseModal = () => {
    setModalAgentId(null);
  };

  return (
    <AgentModal
      agent={agent}
      agentCreditsPrice={agentCreditsPrice}
      agentList={agentList}
      onCloseModal={onCloseModal}
    />
  );
}

export { AgentModalWrapper };
