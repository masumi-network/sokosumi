import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectBrandSetup } from "@/app/projects/components/project-brand-setup";
import { updateProject } from "@/lib/actions/project/action";

const resolveProjectSiteIconMock = vi.fn();

vi.mock("@/lib/actions/project/action", () => ({
  resolveProjectSiteIcon: (...args: unknown[]) =>
    resolveProjectSiteIconMock(...args),
  updateProject: vi.fn(),
}));

vi.mock("@/components/design-md/use-design-md-generation", () => ({
  useDesignMdGeneration: () => ({
    generate: vi.fn(),
    isRunning: false,
    status: "idle",
  }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { user: { id: "viewer-1" } } }),
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
    updateProjectMock.mockResolvedValue({
      ok: true,
      value: { projectId: "project-1" },
    });

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

  // The wizard moves focus to Open project at once, so the progress line is
  // the only word a screen reader gets on how the brand went.
  it("announces how brand setup is going", async () => {
    vi.mocked(updateProject).mockResolvedValue({
      ok: true,
      value: { projectId: "project-1" },
    });

    render(
      <ProjectBrandSetup
        projectId="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
        projectName="Launch"
        websiteUrl="https://acme.com"
      />,
    );

    // A live region from the first render, so the change to ready or
    // failed is read out.
    expect(screen.getByRole("status")).toHaveTextContent("fetching");
    await waitFor(() => {
      expect(updateProject).toHaveBeenCalled();
    });
  });
});
