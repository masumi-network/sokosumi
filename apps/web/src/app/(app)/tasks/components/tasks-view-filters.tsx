"use client";

import { AgentJobStatus, TaskStatus } from "@sokosumi/database";
import {
  CircleDashed,
  type LucideIcon,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useMemo } from "react";

import type { MemberFilterOption } from "@/app/tasks/utils/member-filter-options";
import {
  FilterDropdownMenu,
  type FilterDropdownMenuSection,
} from "@/components/common/filter-dropdown-menu";
import type { CoworkerOption } from "@/lib/types/coworker";

interface AgentFilterOption {
  id: string;
  name: string;
  image: string | null;
}

interface TasksViewFiltersProps {
  activeTab: "tasks" | "jobs";
  memberOptions: MemberFilterOption[];
  coworkerOptions: CoworkerOption[];
  agentOptions: AgentFilterOption[];
  memberId: string | null;
  coworkerId: string | null;
  agentId: string | null;
  taskStatus: TaskStatus | null;
  jobStatus: AgentJobStatus | null;
  onMemberChange: (value: string | null) => void;
  onCoworkerChange: (value: string | null) => void;
  onAgentChange: (value: string | null) => void;
  onTaskStatusChange: (value: TaskStatus | null) => void;
  onJobStatusChange: (value: AgentJobStatus | null) => void;
  labels: {
    all: string;
    title: string;
    member: string;
    coworker: string;
    agent: string;
    taskStatus: string;
    jobStatus: string;
    searchPlaceholder: string;
    emptyResults: string;
    taskStatusOptions: Record<TaskStatus, string>;
    jobStatusOptions: Record<AgentJobStatus, string>;
  };
}

export function TasksViewFilters({
  activeTab,
  memberOptions,
  coworkerOptions,
  agentOptions,
  memberId,
  coworkerId,
  agentId,
  taskStatus,
  jobStatus,
  onMemberChange,
  onCoworkerChange,
  onAgentChange,
  onTaskStatusChange,
  onJobStatusChange,
  labels,
}: TasksViewFiltersProps) {
  const sections = useMemo<FilterDropdownMenuSection[]>(() => {
    const baseSections = memberOptions.length
      ? [
          createSection({
            id: "member",
            label: labels.member,
            icon: UserRound,
            value: memberId,
            allLabel: labels.all,
            onChange: onMemberChange,
            options: memberOptions.map((member) => ({
              value: member.id,
              label: member.name,
              avatarLabel: member.name,
              image: member.image,
            })),
          }),
        ]
      : [];

    if (activeTab === "tasks") {
      return [
        ...baseSections,
        createSection({
          id: "agent",
          label: labels.agent,
          icon: Sparkles,
          value: agentId,
          allLabel: labels.all,
          onChange: onAgentChange,
          options: agentOptions.map((agent) => ({
            value: agent.id,
            label: agent.name,
            avatarLabel: agent.name,
            image: agent.image,
          })),
        }),
        createSection({
          id: "coworker",
          label: labels.coworker,
          icon: Sparkles,
          value: coworkerId,
          allLabel: labels.all,
          onChange: onCoworkerChange,
          options: coworkerOptions.map((coworker) => ({
            value: coworker.id,
            label: coworker.name,
            avatarLabel: coworker.name,
            image: coworker.image,
            searchKeywords: [coworker.slug],
          })),
        }),
        createSection({
          id: "task-status",
          label: labels.taskStatus,
          icon: CircleDashed,
          value: taskStatus,
          allLabel: labels.all,
          onChange: (value) => onTaskStatusChange(value as TaskStatus | null),
          options: Object.values(TaskStatus).map((status) => ({
            value: status,
            label: labels.taskStatusOptions[status],
          })),
        }),
      ];
    }

    return [
      ...baseSections,
      createSection({
        id: "agent",
        label: labels.agent,
        icon: Sparkles,
        value: agentId,
        allLabel: labels.all,
        onChange: onAgentChange,
        options: agentOptions.map((agent) => ({
          value: agent.id,
          label: agent.name,
          avatarLabel: agent.name,
          image: agent.image,
        })),
      }),
      createSection({
        id: "job-status",
        label: labels.jobStatus,
        icon: CircleDashed,
        value: jobStatus,
        allLabel: labels.all,
        onChange: (value) => onJobStatusChange(value as AgentJobStatus | null),
        options: Object.values(AgentJobStatus).map((status) => ({
          value: status,
          label: labels.jobStatusOptions[status],
        })),
      }),
    ];
  }, [
    activeTab,
    agentId,
    agentOptions,
    coworkerId,
    coworkerOptions,
    jobStatus,
    labels.agent,
    labels.all,
    labels.coworker,
    labels.jobStatus,
    labels.jobStatusOptions,
    labels.member,
    labels.taskStatus,
    labels.taskStatusOptions,
    memberId,
    memberOptions,
    onAgentChange,
    onCoworkerChange,
    onJobStatusChange,
    onMemberChange,
    onTaskStatusChange,
    taskStatus,
  ]);

  return (
    <FilterDropdownMenu
      buttonLabel={labels.title}
      searchPlaceholder={labels.searchPlaceholder}
      emptyResultsLabel={labels.emptyResults}
      sections={sections}
    />
  );
}

function createSection({
  id,
  label,
  icon,
  value,
  allLabel,
  onChange,
  options,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  value: string | null;
  allLabel?: string;
  onChange: (value: string | null) => void;
  options: FilterDropdownMenuSection["options"];
}): FilterDropdownMenuSection {
  return {
    id,
    label,
    icon,
    value,
    allLabel,
    onChange,
    options,
  };
}
