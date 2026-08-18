import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectBrandSetup } from "@/app/projects/components/project-brand-setup";
import { updateProject } from "@/lib/actions/project/action";

const resolveProjectSiteIconMock = vi.fn();

vi.mock("@/lib/actions/project/action", () => ({
  resolveProjectSiteIcon: (...args: unknown[]) =>
    resolveProjectSiteIconMock(...args),
  updateProject: vi.fn(),
}));

vi.mock("@/components/design-md", () => ({
  DESIGN_MD_TRANSLATION_NAMESPACE: "App.DesignMd",
  useDesignMdGeneration: () => ({
    generate: vi.fn(),
    isRunning: false,
    status: "idle",
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

describe("ProjectBrandSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveProjectSiteIconMock.mockResolvedValue({
      ok: true,
      value: { url: "https://blob.example/logo.png" },
    });
  });

  it("updates the project logo without sending briefing", async () => {
    const updateProjectMock = vi.mocked(updateProject);
    updateProjectMock.mockResolvedValue({ projectId: "project-1" });

    render(
      <ProjectBrandSetup
        projectId="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
        projectName="Launch"
        websiteUrl="https://acme.com"
      />,
    );

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith({
        projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        name: "Launch",
        logo: "https://blob.example/logo.png",
      });
    });
    expect(updateProjectMock.mock.calls[0]?.[0]).not.toHaveProperty("briefing");
  });
});
