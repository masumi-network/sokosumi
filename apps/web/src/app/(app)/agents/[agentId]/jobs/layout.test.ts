import { createTranslator } from "next-intl";
import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

const getCoreAgentByIdMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "App.Agents.Jobs.Header") =>
    createTranslator({ locale: "en", messages, namespace }),
}));
vi.mock("@/lib/agents/core-loaders", () => ({
  getCoreAgentById: (...args: unknown[]) => getCoreAgentByIdMock(...args),
}));
const getSessionMock = vi.fn();
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));
vi.mock("@/lib/services/agent.service", () => ({ agentService: {} }));
const getMyWorkspacesMock = vi.fn();
vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyWorkspaces: (...args: unknown[]) => getMyWorkspacesMock(...args),
  },
}));
const getLastKnownAgentNameMock = vi.fn();
const getCachedMyJobsMock = vi.fn();
vi.mock("./_lib/get-cached-my-jobs", () => ({
  getCachedMyJobs: (...args: unknown[]) => getCachedMyJobsMock(...args),
  getLastKnownAgentName: (...args: unknown[]) =>
    getLastKnownAgentNameMock(...args),
}));

const AGENT_ID = "agent_unavailable_test";
const params = Promise.resolve({ agentId: AGENT_ID });

describe("jobs layout metadata", () => {
  beforeEach(() => {
    getCoreAgentByIdMock.mockReset();
    getLastKnownAgentNameMock.mockReset().mockResolvedValue(null);
  });

  it("titles the tab with the agent's name", async () => {
    getCoreAgentByIdMock.mockResolvedValue({
      name: "Advanced Web Research",
      description: "Researches the web.",
    });
    const { generateMetadata } = await import("./layout");

    await expect(
      generateMetadata({ params, children: null, modal: null, right: null }),
    ).resolves.toMatchObject({ title: "Advanced Web Research" });
  });

  it("never shows the raw id when the agent left the catalog", async () => {
    getCoreAgentByIdMock.mockResolvedValue(null);
    const { generateMetadata } = await import("./layout");

    const metadata = await generateMetadata({
      params,
      children: null,
      modal: null,
      right: null,
    });

    expect(metadata.title).toBe("Unavailable agent");
  });

  it("keeps a delisted agent's name, read through the viewer's jobs", async () => {
    getCoreAgentByIdMock.mockResolvedValue(null);
    getLastKnownAgentNameMock.mockResolvedValue("Web Research Agent");
    const { generateMetadata } = await import("./layout");

    const metadata = await generateMetadata({
      params,
      children: null,
      modal: null,
      right: null,
    });

    expect(metadata.title).toBe("Web Research Agent");
    expect(getLastKnownAgentNameMock).toHaveBeenCalledWith(AGENT_ID);
  });
});

/** Every element of a tree that has not been rendered, depth first. */
function elements(node: ReactNode): { type: unknown; props: unknown }[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...elements(node.props.children)];
}

/**
 * The Workspace the layout hands its jobs list: the layout's own async
 * component, run as the server would, and the list's props read from its
 * output.
 */
async function listWorkspaceId() {
  const { default: JobLayout } = await import("./layout");
  const { JobsList } = await import("./components/jobs-list");
  const shell = await JobLayout({
    params,
    children: null,
    modal: null,
    right: null,
  });
  const inner = elements(shell).find(
    ({ type }) => typeof type === "function" && type.name === "JobLayoutInner",
  );
  if (!inner) throw new Error("The layout renders no JobLayoutInner");
  const render = inner.type as (props: unknown) => Promise<ReactNode>;
  const list = elements(await render(inner.props)).find(
    ({ type }) => type === JobsList,
  );
  if (!list) throw new Error("The layout renders no JobsList");
  return (list.props as { workspaceId: string | null }).workspaceId;
}

const PERSONAL = { id: "workspace-personal", organizationId: null };
const ORGANIZATION = { id: "workspace-org", organizationId: "org-1" };
const jobIn = (workspaceId: string) => ({ workspace: { id: workspaceId } });

describe("the jobs list's Workspace", () => {
  beforeEach(() => {
    getCoreAgentByIdMock.mockReset().mockResolvedValue(null);
    getLastKnownAgentNameMock.mockReset().mockResolvedValue(null);
    getSessionMock.mockReset();
    getMyWorkspacesMock.mockReset();
    getCachedMyJobsMock.mockReset();
  });

  function given(input: {
    activeOrganizationId: string | null;
    workspaces: (typeof PERSONAL | typeof ORGANIZATION)[];
    jobs: ReturnType<typeof jobIn>[];
  }) {
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: input.activeOrganizationId },
    });
    getMyWorkspacesMock.mockResolvedValue({ workspaces: input.workspaces });
    getCachedMyJobsMock.mockResolvedValue({
      jobs: input.jobs,
      nextCursor: null,
      total: input.jobs.length,
    });
  }

  // The membership ended: the session still names the Organization, and Core
  // answers with the personal Workspace's Jobs.
  it("is the Workspace of the Jobs Core returned, under a session that names an Organization the user has left", async () => {
    given({
      activeOrganizationId: "org-1",
      workspaces: [PERSONAL],
      jobs: [jobIn(PERSONAL.id)],
    });

    expect(await listWorkspaceId()).toBe(PERSONAL.id);
  });

  it("is the Workspace of the Jobs Core returned, not the one the session names", async () => {
    given({
      activeOrganizationId: null,
      workspaces: [PERSONAL, ORGANIZATION],
      jobs: [jobIn(ORGANIZATION.id)],
    });

    expect(await listWorkspaceId()).toBe(ORGANIZATION.id);
  });

  it("is the session's active Workspace for an empty list", async () => {
    given({
      activeOrganizationId: "org-1",
      workspaces: [PERSONAL, ORGANIZATION],
      jobs: [],
    });

    expect(await listWorkspaceId()).toBe(ORGANIZATION.id);
  });
});
