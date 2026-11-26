import { createTranslator } from "next-intl";
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
vi.mock("@/lib/auth/auth.server", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/services/agent.service", () => ({ agentService: {} }));
const getLastKnownAgentNameMock = vi.fn();
vi.mock("./_lib/get-cached-my-jobs", () => ({
  getCachedMyJobs: vi.fn(),
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

  it("keeps the name the viewer's jobs recorded for a delisted agent", async () => {
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
