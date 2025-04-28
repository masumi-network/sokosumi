import { useEffect, useState } from "react";

import { AgentWithRelations, CreditsPrice, getAgentById } from "@/lib/db";
import { getAgentCreditsPrice } from "@/lib/services";

export default function useAgentDetail(agentId: string | null) {
  const [agent, setAgent] = useState<AgentWithRelations | undefined>();
  const [agentCreditsPrice, setAgentCreditsPrice] = useState<
    CreditsPrice | undefined
  >();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const resetData = () => {
    setAgent(undefined);
    setAgentCreditsPrice(undefined);
    setError(null);
  };

  useEffect(() => {
    if (!agentId) {
      resetData();
      setIsLoading(false);
      return;
    }

    const fetchAgentDetailData = async () => {
      resetData();
      setIsLoading(true);

      try {
        const agent = await getAgentById(agentId);
        if (!agent) {
          throw new Error("Agent not found");
        }
        const agentCreditsPrice = await getAgentCreditsPrice(agent);
        setAgent(agent);
        setAgentCreditsPrice(agentCreditsPrice);
      } catch (err) {
        if (err instanceof Error) {
          setError(err);
        } else {
          setError(new Error("An unknown error occurred while fetching jobs"));
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchAgentDetailData();
  }, [agentId]);

  return { agent, agentCreditsPrice, isLoading, error };
}
