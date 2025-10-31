"use client";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { createContext, useContext, useMemo, useState } from "react";

interface CreateJobModalContextType {
  // modal open
  open: boolean;
  setOpen: (open: boolean) => void;
  handleOpen: (agentId: string, isDemo?: boolean) => void;
  handleClose: () => void;
  // create job form loading
  loading: boolean;
  setLoading: (loading: boolean) => void;
  // accordion
  isExpanded: boolean;
  accordionValue: string[];
  setAccordionValue: (accordionValue: string[]) => void;
  handleExpand: () => void;
  handleCollapse: () => void;
  // agents with price
  agentsWithPrice: AgentWithCreditsPrice[];
  // selected agent
  agentId?: string | undefined;
  isDemo: boolean;
  setAgentId: (agentId: string) => void;
  agentWithPrice?: AgentWithCreditsPrice | undefined;
  // average execution duration
  averageExecutionDuration: number;
}

const initialState: CreateJobModalContextType = {
  open: false,
  setOpen: () => {},
  handleOpen: () => {},
  handleClose: () => {},
  loading: false,
  setLoading: () => {},
  isExpanded: false,
  accordionValue: ["information", "input"],
  setAccordionValue: () => {},
  handleExpand: () => {},
  handleCollapse: () => {},
  agentsWithPrice: [],
  agentId: undefined,
  isDemo: false,
  setAgentId: () => {},
  averageExecutionDuration: 0,
};

export const CreateJobModalContext =
  createContext<CreateJobModalContextType>(initialState);

export function CreateJobModalContextProvider({
  agentsWithPrice,
  averageExecutionDuration,
  children,
}: {
  agentsWithPrice: AgentWithCreditsPrice[];
  averageExecutionDuration: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accordionValue, setAccordionValue] = useState<string[]>(["input"]);
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const [isDemo, setIsDemo] = useState(false);

  const agentWithPrice = useMemo(() => {
    if (!agentId) {
      return;
    }
    const result = agentsWithPrice.find((agent) => agent.id === agentId);
    if (!result) {
      console.error("agent not found in agentsWithPrice", agentId);
    }
    return result;
  }, [agentsWithPrice, agentId]);

  const handleExpand = () => {
    setAccordionValue(["information", "input"]);
  };

  const handleCollapse = () => {
    setAccordionValue([]);
  };

  const handleOpen = (agentId: string, isDemo?: boolean) => {
    setOpen(true);
    setAgentId(agentId);
    setIsDemo(isDemo ?? false);
  };

  const handleClose = () => {
    setOpen(false);
    setAgentId(undefined);
  };

  const value: CreateJobModalContextType = {
    open,
    setOpen,
    handleOpen,
    handleClose,
    loading,
    setLoading,
    isExpanded: accordionValue.length === 2,
    accordionValue,
    setAccordionValue,
    handleExpand,
    handleCollapse,
    agentsWithPrice,
    agentId,
    isDemo,
    setAgentId,
    agentWithPrice,
    averageExecutionDuration,
  };

  return (
    <CreateJobModalContext.Provider value={value}>
      {children}
    </CreateJobModalContext.Provider>
  );
}

export function useCreateJobModalContext() {
  const context = useContext(CreateJobModalContext);
  if (!context) {
    throw new Error(
      "useCreateJobModal must be used within a CreateJobModalProvider",
    );
  }
  return context;
}
