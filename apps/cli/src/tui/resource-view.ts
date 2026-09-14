import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import type { CoreHttpClient } from "../api/http-client.js";
import type { Agent } from "../api/models/agent.js";
import type { AgentJob } from "../api/models/agent-job.js";
import type { Coworker } from "../api/models/coworker.js";
import type { Task } from "../api/models/task.js";
import type { User } from "../api/models/user.js";
import { fetchAgents } from "../api/services/agent-service.js";
import { fetchCoworkers } from "../api/services/coworker-service.js";
import { fetchJobs } from "../api/services/job-service.js";
import { fetchTasks } from "../api/services/task-service.js";
import { fetchCurrentUser } from "../api/services/user-service.js";
import { redactErrorMessage } from "../error-redaction.js";
import { SelectInput, type SelectItem } from "./select-input.js";
import { TUI_THEME } from "./theme.js";

export type ResourceKind =
  | "dashboard"
  | "agents"
  | "coworkers"
  | "tasks"
  | "jobs"
  | "account";

type ResourceData =
  | {
      kind: "dashboard";
      counts: ResourceCounts;
      failures: string[];
      recentTasks: Task[];
    }
  | { kind: "agents"; items: Agent[] }
  | { kind: "coworkers"; items: Coworker[] }
  | { kind: "tasks"; items: Task[] }
  | { kind: "jobs"; items: AgentJob[] }
  | { kind: "account"; user: User };

type ResourceState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ResourceData };

interface ResourceCounts {
  agents: number | null;
  coworkers: number | null;
  tasks: number | null;
  jobs: number | null;
}

export interface ResourceViewProps {
  resource: ResourceKind;
  coreClient?: CoreHttpClient;
  onBack: () => void;
  onNavigate?: (
    resource: Exclude<ResourceKind, "dashboard" | "account">,
  ) => void;
  listen?: boolean;
  accountAuthMethod?: "oauth" | "api-key" | null;
  accountTarget?: string;
}

const resourceTitles: Record<ResourceKind, string> = {
  dashboard: "Dashboard",
  agents: "Agents",
  coworkers: "Coworkers",
  tasks: "Tasks",
  jobs: "Jobs",
  account: "Account",
};

function readable(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}
export const safeError = redactErrorMessage;

export function paginationTotal(
  response: { meta?: Record<string, unknown> },
  fallback: number,
): number {
  const meta = response.meta || {};
  const pagination =
    meta.pagination && typeof meta.pagination === "object"
      ? (meta.pagination as Record<string, unknown>)
      : {};
  const candidate = [
    meta.total,
    meta.totalCount,
    meta.totalItems,
    meta.count,
    pagination.total,
    pagination.totalCount,
    pagination.totalItems,
    pagination.count,
  ].find(
    (value): value is number | string =>
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && /^\d+$/.test(value)),
  );
  return candidate === undefined ? fallback : Number(candidate);
}

export function recentTaskActivity(tasks: readonly Task[], limit = 5): Task[] {
  return tasks
    .filter(
      (task) =>
        task.updatedAt !== null && !Number.isNaN(Date.parse(task.updatedAt)),
    )
    .slice()
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt as string) -
        Date.parse(left.updatedAt as string),
    )
    .slice(0, limit);
}

function titleLine(title: string): React.ReactElement {
  return React.createElement(
    Text,
    { bold: true, color: TUI_THEME.accent },
    `/ ${title}`,
  );
}

function navigationHint(): React.ReactElement {
  return React.createElement(
    Text,
    { dimColor: true },
    "Use arrows, then Enter · Esc back · q quit",
  );
}

function resourceItems<T>(
  items: readonly T[],
  label: (item: T) => string,
): SelectItem<string>[] {
  return [
    ...items.map((item, index) => ({
      value: String(index),
      label: label(item),
    })),
    { value: "back", label: "Back" },
  ];
}

function renderDetail(
  title: string,
  fields: readonly string[],
  onBack: () => void,
  listen = true,
): React.ReactElement {
  return React.createElement(
    Box,
    { flexDirection: "column" },
    titleLine(title),
    ...fields.map((field) => React.createElement(Text, { key: field }, field)),
    React.createElement(SelectInput, {
      items: [{ value: "back", label: "Back" }],
      onSelect: onBack,
      listen,
    }),
    navigationHint(),
  );
}

function preview(
  value: string | null | undefined,
  fallback: string,
  maxLength = 240,
): string {
  const text = value?.trim() || fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function formatDate(value: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function displayUnknown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string") return record.name.trim();
    if (typeof record.id === "string") return record.id.trim();
  }
  return "";
}

function listUnknown(values: readonly unknown[]): string {
  const labels = values.map(displayUnknown).filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : "none";
}

function renderList<T>(
  title: string,
  items: readonly T[],
  label: (item: T) => string,
  onSelect: (item: T) => void,
  onBack: () => void,
  listen = true,
): React.ReactElement {
  const selectorItems = resourceItems(items, label);
  return React.createElement(
    Box,
    { flexDirection: "column" },
    titleLine(title),
    items.length === 0
      ? React.createElement(
          Text,
          { dimColor: true },
          `No ${title.toLowerCase()} found.`,
        )
      : null,
    React.createElement(SelectInput, {
      items: selectorItems,
      onSelect: (value: unknown) => {
        if (value === "back") {
          onBack();
          return;
        }
        const index = Number(value);
        if (Number.isInteger(index) && index >= 0 && index < items.length) {
          onSelect(items[index]);
        }
      },
      listen,
    }),
    navigationHint(),
  );
}

function renderAgentDetail(
  agent: Agent,
  onBack: () => void,
  listen = true,
): React.ReactElement {
  const tags = agent.tags
    .map((tag) => tag.name?.trim())
    .filter((tag): tag is string => Boolean(tag))
    .join(", ");
  return renderDetail(
    preview(agent.name, "Agent"),
    [
      `ID: ${readable(agent.id, "not available")}`,
      `Status: ${readable(agent.status, "unknown")}`,
      `Price: ${agent.price.credits === null ? "unknown" : `${agent.price.credits} credits`}`,
      `Tags: ${tags || "none"}`,
      `Description: ${preview(agent.description, "Not provided.")}`,
      `Created: ${formatDate(agent.createdAt)}`,
    ],
    onBack,
    listen,
  );
}

function renderCoworkerDetail(
  coworker: Coworker,
  onBack: () => void,
  listen = true,
): React.ReactElement {
  return renderDetail(
    preview(coworker.name, "Coworker"),
    [
      `ID: ${readable(coworker.id, "not available")}`,
      `Status: ${readable(coworker.status, "unknown")}`,
      `Company: ${readable(coworker.company, "not provided")}`,
      `Capabilities: ${listUnknown(coworker.capabilities)}`,
      `Price: ${coworker.price.credits === null ? "unknown" : `${coworker.price.credits} credits`}`,
      `Description: ${preview(coworker.description, "Not provided.")}`,
      `URL: ${readable(coworker.url, "not provided")}`,
    ],
    onBack,
    listen,
  );
}

function renderTaskDetail(
  task: Task,
  onBack: () => void,
  listen = true,
): React.ReactElement {
  return renderDetail(
    preview(task.name, "Task"),
    [
      `ID: ${readable(task.id, "not available")}`,
      `Status: ${readable(task.status, "unknown")}`,
      `Coworker: ${readable(task.coworkerName || task.coworkerId, "not assigned")}`,
      `Jobs: ${task.jobs.length}`,
      `Events: ${task.events.length}`,
      `Credits: ${task.totalCredits === null ? "unknown" : task.totalCredits}`,
      `Description: ${preview(task.description, "Not provided.")}`,
      `Updated: ${formatDate(task.updatedAt)}`,
    ],
    onBack,
    listen,
  );
}

function renderJobDetail(
  job: AgentJob,
  onBack: () => void,
  listen = true,
): React.ReactElement {
  return renderDetail(
    preview(job.name, "Job"),
    [
      `ID: ${readable(job.id, "not available")}`,
      `Status: ${readable(job.status, "unknown")}`,
      `Agent ID: ${readable(job.agentId, "not available")}`,
      `Created: ${formatDate(job.createdAt)}`,
      `Updated: ${formatDate(job.updatedAt)}`,
    ],
    onBack,
    listen,
  );
}

function renderDashboard(
  counts: ResourceCounts,
  failures: readonly string[],
  recentTasks: readonly Task[],
  onBack: () => void,
  onNavigate?: (
    resource: Exclude<ResourceKind, "dashboard" | "account">,
  ) => void,
  listen = true,
): React.ReactElement {
  const count = (value: number | null): string =>
    value === null ? "unavailable" : String(value);
  const items: SelectItem<string>[] = [
    { value: "agents", label: `Agents: ${count(counts.agents)}` },
    { value: "coworkers", label: `Coworkers: ${count(counts.coworkers)}` },
    { value: "tasks", label: `Tasks: ${count(counts.tasks)}` },
    { value: "jobs", label: `Jobs: ${count(counts.jobs)}` },
    { value: "back", label: "Back" },
  ];
  return React.createElement(
    Box,
    { flexDirection: "column" },
    titleLine("Dashboard"),
    React.createElement(
      Text,
      { bold: true, color: TUI_THEME.accent },
      "Recent task activity",
    ),
    recentTasks.length === 0
      ? React.createElement(
          Text,
          { dimColor: true },
          "No recent task activity.",
        )
      : React.createElement(
          Box,
          { flexDirection: "column" },
          ...recentTasks.map((task) =>
            React.createElement(
              Text,
              { key: task.id || task.updatedAt || task.name || "task" },
              `• ${readable(task.name, "Unnamed task")} · ${readable(task.status, "unknown")} · ${formatDate(task.updatedAt)}`,
            ),
          ),
        ),
    failures.length > 0
      ? React.createElement(
          Text,
          { dimColor: true },
          `Some counts could not be loaded (${failures.length}).`,
        )
      : null,
    React.createElement(SelectInput, {
      items,
      onSelect: (value: unknown) => {
        if (value === "back") {
          onBack();
          return;
        }
        if (
          value === "agents" ||
          value === "coworkers" ||
          value === "tasks" ||
          value === "jobs"
        ) {
          onNavigate?.(value);
        }
      },
      listen,
    }),
    navigationHint(),
  );
}

function renderAccount(
  user: User,
  onBack: () => void,
  listen = true,
  authMethod: "oauth" | "api-key" | null = null,
  target = "unknown",
): React.ReactElement {
  const items: SelectItem<string>[] = [{ value: "back", label: "Back" }];
  return React.createElement(
    Box,
    { flexDirection: "column" },
    titleLine("Account"),
    React.createElement(Text, { color: TUI_THEME.success }, "● Signed in"),
    React.createElement(
      Text,
      null,
      `Auth method: ${authMethod === "api-key" ? "user API key" : "browser OAuth"}`,
    ),
    React.createElement(Text, null, `Target: ${target}`),
    React.createElement(SelectInput, {
      items,
      onSelect: () => onBack(),
      listen,
    }),
    navigationHint(),
  );
}

export function ResourceView({
  resource,
  coreClient,
  onBack,
  onNavigate,
  listen = true,
  accountAuthMethod = null,
  accountTarget = "unknown",
}: ResourceViewProps): React.ReactElement {
  const [state, setState] = useState<ResourceState>({ status: "loading" });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!listen) setSelectedIndex(null);
  }, [listen]);

  useEffect(() => {
    setSelectedIndex(null);
    let cancelled = false;
    const controller = new AbortController();
    setState({ status: coreClient ? "loading" : "unavailable" });
    if (!coreClient) return () => controller.abort();

    const load = async (): Promise<void> => {
      try {
        if (resource === "dashboard") {
          const results = await Promise.allSettled([
            fetchAgents(coreClient, controller.signal),
            fetchCoworkers(coreClient, {}, controller.signal),
            fetchTasks(coreClient, {}, controller.signal),
            fetchJobs(coreClient, controller.signal),
          ]);
          if (cancelled) return;
          const [agents, coworkers, tasks, jobs] = results;
          const failures = results
            .filter((result) => result.status === "rejected")
            .map((result) =>
              result.status === "rejected" ? safeError(result.reason) : "",
            );
          if (failures.length === results.length) {
            setState({
              status: "error",
              message: failures[0] || "Unable to load dashboard",
            });
            return;
          }
          setState({
            status: "ready",
            data: {
              kind: "dashboard",
              counts: {
                agents:
                  agents.status === "fulfilled"
                    ? paginationTotal(
                        agents.value.response,
                        agents.value.agents.length,
                      )
                    : null,
                coworkers:
                  coworkers.status === "fulfilled"
                    ? paginationTotal(
                        coworkers.value.response,
                        coworkers.value.coworkers.length,
                      )
                    : null,
                tasks:
                  tasks.status === "fulfilled"
                    ? paginationTotal(
                        tasks.value.response,
                        tasks.value.tasks.length,
                      )
                    : null,
                jobs:
                  jobs.status === "fulfilled"
                    ? paginationTotal(
                        jobs.value.response,
                        jobs.value.jobs.length,
                      )
                    : null,
              },
              failures,
              recentTasks:
                tasks.status === "fulfilled"
                  ? recentTaskActivity(tasks.value.tasks)
                  : [],
            },
          });
          return;
        }

        if (resource === "agents") {
          const result = await fetchAgents(coreClient, controller.signal);
          if (!cancelled)
            setState({
              status: "ready",
              data: { kind: resource, items: result.agents },
            });
          return;
        }
        if (resource === "coworkers") {
          const result = await fetchCoworkers(
            coreClient,
            {},
            controller.signal,
          );
          if (!cancelled)
            setState({
              status: "ready",
              data: { kind: resource, items: result.coworkers },
            });
          return;
        }
        if (resource === "tasks") {
          const result = await fetchTasks(coreClient, {}, controller.signal);
          if (!cancelled)
            setState({
              status: "ready",
              data: { kind: resource, items: result.tasks },
            });
          return;
        }
        if (resource === "jobs") {
          const result = await fetchJobs(coreClient, controller.signal);
          if (!cancelled)
            setState({
              status: "ready",
              data: { kind: resource, items: result.jobs },
            });
          return;
        }

        const result = await fetchCurrentUser(coreClient, controller.signal);
        if (!cancelled)
          setState({
            status: "ready",
            data: { kind: "account", user: result.user },
          });
      } catch (error: unknown) {
        if (!cancelled && !controller.signal.aborted) {
          setState({ status: "error", message: safeError(error) });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [coreClient, resource]);

  if (state.status === "loading")
    return React.createElement(
      Text,
      { color: TUI_THEME.accent },
      `Loading ${(resourceTitles[resource] || "resource").toLowerCase()}...`,
    );
  if (state.status === "unavailable") {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      titleLine(resourceTitles[resource]),
      React.createElement(Text, null, "Core API client unavailable."),
      React.createElement(SelectInput, {
        items: [{ value: "back", label: "Back" }],
        onSelect: onBack,
        listen,
      }),
      navigationHint(),
    );
  }
  if (state.status === "error") {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      titleLine(resourceTitles[resource]),
      React.createElement(
        Text,
        { color: TUI_THEME.error },
        `Error: ${state.message}`,
      ),
      React.createElement(SelectInput, {
        items: [{ value: "back", label: "Back" }],
        onSelect: onBack,
        listen,
      }),
      navigationHint(),
    );
  }

  const { data } = state;
  if (data.kind === "dashboard")
    return renderDashboard(
      data.counts,
      data.failures,
      data.recentTasks,
      onBack,
      onNavigate,
      listen,
    );
  if (data.kind === "account")
    return renderAccount(
      data.user,
      onBack,
      listen,
      accountAuthMethod,
      accountTarget,
    );

  const listBack =
    selectedIndex === null ? onBack : () => setSelectedIndex(null);
  if (data.kind === "agents") {
    const selected =
      selectedIndex === null ? undefined : data.items[selectedIndex];
    if (selected)
      return renderAgentDetail(selected, () => setSelectedIndex(null), listen);
    return renderList(
      "Agents",
      data.items,
      (item) =>
        `${readable(item.name, "Unnamed agent")} · ID: ${readable(item.id, "none")} · Status: ${readable(item.status, "unknown")}`,
      (item) => setSelectedIndex(data.items.indexOf(item)),
      listBack,
      listen,
    );
  }
  if (data.kind === "coworkers") {
    const selected =
      selectedIndex === null ? undefined : data.items[selectedIndex];
    if (selected)
      return renderCoworkerDetail(
        selected,
        () => setSelectedIndex(null),
        listen,
      );
    return renderList(
      "Coworkers",
      data.items,
      (item) =>
        `${readable(item.name, "Unnamed coworker")} · ID: ${readable(item.id, "none")} · Status: ${readable(item.status, "unknown")}`,
      (item) => setSelectedIndex(data.items.indexOf(item)),
      listBack,
      listen,
    );
  }
  if (data.kind === "tasks") {
    const selected =
      selectedIndex === null ? undefined : data.items[selectedIndex];
    if (selected)
      return renderTaskDetail(selected, () => setSelectedIndex(null), listen);
    return renderList(
      "Tasks",
      data.items,
      (item) =>
        `${readable(item.name, "Unnamed task")} · ID: ${readable(item.id, "none")} · Status: ${readable(item.status, "unknown")}`,
      (item) => setSelectedIndex(data.items.indexOf(item)),
      listBack,
      listen,
    );
  }
  const selected =
    selectedIndex === null ? undefined : data.items[selectedIndex];
  if (selected)
    return renderJobDetail(selected, () => setSelectedIndex(null), listen);
  return renderList(
    "Jobs",
    data.items,
    (item) =>
      `${readable(item.name, "Unnamed job")} · ID: ${readable(item.id, "none")} · Status: ${readable(item.status, "unknown")}`,
    (item) => setSelectedIndex(data.items.indexOf(item)),
    listBack,
    listen,
  );
}
