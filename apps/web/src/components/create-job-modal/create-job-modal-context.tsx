"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import type { CoreAgentDto } from "@/lib/types/core-dto";

export interface CreateJobModalOpenOptions {
  projectId?: string | null;
}

interface CreateJobModalContextType {
  // modal open
  open: boolean;
  setOpen: (open: boolean) => void;
  handleOpen: (agentId: string, options?: CreateJobModalOpenOptions) => void;
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
  agentsWithPrice: CoreAgentDto[];
  // selected agent
  agentId?: string | undefined;
  setAgentId: (agentId: string) => void;
  agentWithPrice?: CoreAgentDto | undefined;
  // average execution duration
  averageExecutionDuration: number | null;
  // project selection
  projectOptions?: ProjectFilterOption[] | undefined;
  projectId: string | null;
  setProjectId: (projectId: string | null) => void;
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
  setAgentId: () => {},
  averageExecutionDuration: null,
  projectOptions: undefined,
  projectId: null,
  setProjectId: () => {},
};

export const CreateJobModalContext =
  createContext<CreateJobModalContextType>(initialState);

export function CreateJobModalContextProvider({
  agentsWithPrice,
  averageExecutionDuration,
  projectOptions,
  defaultProjectId = null,
  children,
}: {
  agentsWithPrice: CoreAgentDto[];
  averageExecutionDuration: number | null;
  projectOptions?: ProjectFilterOption[] | undefined;
  defaultProjectId?: string | null | undefined;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accordionValue, setAccordionValue] = useState<string[]>(["input"]);
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const [projectId, setProjectIdState] = useState<string | null>(
    defaultProjectId ?? null,
  );

  const setProjectId = useCallback((nextProjectId: string | null) => {
    setProjectIdState(nextProjectId);
  }, []);

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

  const handleOpen = (agentId: string, options?: CreateJobModalOpenOptions) => {
    setOpen(true);
    setAgentId(agentId);
    setProjectIdState(options?.projectId ?? defaultProjectId ?? null);
  };

  const handleClose = () => {
    setOpen(false);
    setAgentId(undefined);
    setProjectIdState(defaultProjectId ?? null);
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
    setAgentId,
    agentWithPrice,
    averageExecutionDuration,
    projectOptions,
    projectId,
    setProjectId,
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
