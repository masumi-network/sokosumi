"use client";

import type { AgentWithCreditsPrice } from "@sokosumi/database";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import {
  type UseJobScheduleReturn,
  useJobSchedule,
} from "@/hooks/use-job-schedule";
import {
  type JobScheduleSelectionType,
  JobScheduleType,
} from "@/lib/types/job";

interface CreateJobModalContextType {
  // modal open
  open: boolean;
  setOpen: (open: boolean) => void;
  handleOpen: (
    agentId: string,
    isDemo?: boolean,
    projectOverrideId?: string | null,
  ) => void;
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
  averageExecutionDuration: number | null;
  // project selection
  projectOptions?: ProjectFilterOption[] | undefined;
  projectId: string | null;
  setProjectId: (projectId: string | null) => void;
  // job schedule
  scheduleOpen: boolean;
  setScheduleOpen: (open: boolean) => void;
  scheduleSelection: JobScheduleSelectionType | null;
  setScheduleSelection: (selection: JobScheduleSelectionType | null) => void;
  timezoneOptions: string[];
  isScheduled: boolean;
  nextRunAt: Date | null;
  nextRunLabel: string | null;
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
  averageExecutionDuration: null,
  projectOptions: undefined,
  projectId: null,
  setProjectId: () => {},
  scheduleOpen: false,
  setScheduleOpen: () => {},
  scheduleSelection: null,
  setScheduleSelection: () => {},
  timezoneOptions: [],
  isScheduled: false,
  nextRunAt: null,
  nextRunLabel: null,
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
  agentsWithPrice: AgentWithCreditsPrice[];
  averageExecutionDuration: number | null;
  projectOptions?: ProjectFilterOption[] | undefined;
  defaultProjectId?: string | null | undefined;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accordionValue, setAccordionValue] = useState<string[]>(["input"]);
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const [isDemo, setIsDemo] = useState(false);
  const [projectId, setProjectIdState] = useState<string | null>(
    defaultProjectId ?? null,
  );
  const {
    scheduleOpen,
    setScheduleOpen,
    scheduleSelection,
    setScheduleSelection: setScheduleSelectionInternal,
    timezoneOptions,
    isScheduled,
    nextRunAt,
    nextRunLabel,
  }: UseJobScheduleReturn = useJobSchedule();

  const setProjectId = useCallback((nextProjectId: string | null) => {
    setProjectIdState(nextProjectId);
  }, []);

  const setScheduleSelection = useCallback(
    (selection: JobScheduleSelectionType | null) => {
      setScheduleSelectionInternal(selection);

      if (selection && selection.mode !== JobScheduleType.NOW) {
        setProjectIdState(null);
        return;
      }

      if (selection?.mode === JobScheduleType.NOW) {
        setProjectIdState(defaultProjectId ?? null);
      }
    },
    [defaultProjectId, setScheduleSelectionInternal],
  );

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

  const handleOpen = (
    agentId: string,
    isDemo?: boolean,
    projectOverrideId?: string | null,
  ) => {
    setOpen(true);
    setAgentId(agentId);
    setIsDemo(isDemo ?? false);
    setProjectIdState(projectOverrideId ?? defaultProjectId ?? null);
    setScheduleSelectionInternal(null);
  };

  const handleClose = () => {
    setOpen(false);
    setAgentId(undefined);
    setIsDemo(false);
    setProjectIdState(defaultProjectId ?? null);
    setScheduleSelectionInternal(null);
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
    projectOptions,
    projectId,
    setProjectId,
    scheduleOpen,
    setScheduleOpen,
    scheduleSelection,
    setScheduleSelection,
    timezoneOptions,
    isScheduled,
    nextRunAt,
    nextRunLabel,
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
