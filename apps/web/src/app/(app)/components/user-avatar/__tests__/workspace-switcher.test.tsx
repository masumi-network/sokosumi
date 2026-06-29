import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateOrganizationWorkspace,
  getAgentJobsBasePath,
  getTaskDetailBasePath,
  useWorkspaceSwitcher,
} from "@/app/components/user-avatar/workspace-switcher";
import { updatePreferredOrganization } from "@/lib/actions/organization";
import { authClient } from "@/lib/auth/auth.client";

const replaceMock = vi.fn();
const refreshMock = vi.fn();
let pathnameMock = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock,
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      setActive: vi.fn(),
    },
  },
}));

vi.mock("@/lib/actions/organization", () => ({
  updatePreferredOrganization: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

function WorkspaceSwitcherTestComponent() {
  const { handleSelectWorkspace } = useWorkspaceSwitcher();

  return (
    <button type="button" onClick={() => handleSelectWorkspace("org-1")}>
      Switch workspace
    </button>
  );
}

describe("workspace switcher", () => {
  beforeEach(() => {
    pathnameMock = "/";
    replaceMock.mockClear();
    refreshMock.mockClear();
    vi.mocked(authClient.organization.setActive).mockReset();
    vi.mocked(updatePreferredOrganization).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  describe("activateOrganizationWorkspace", () => {
    it("sets the active organization and persists it as preferred", async () => {
      vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
        data: null,
        error: null,
      });
      vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
        ok: true,
        data: {
          organizationId: "org-7",
        },
      });

      await activateOrganizationWorkspace("org-7");

      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-7",
      });
      expect(updatePreferredOrganization).toHaveBeenCalledWith({
        organizationId: "org-7",
      });
    });

    it("activates the personal workspace when given null", async () => {
      vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
        data: null,
        error: null,
      });
      vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
        ok: true,
        data: {
          organizationId: null,
        },
      });

      await activateOrganizationWorkspace(null);

      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: null,
      });
      expect(updatePreferredOrganization).toHaveBeenCalledWith({
        organizationId: null,
      });
    });

    it("still resolves when persisting the preferred organization fails", async () => {
      vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
        data: null,
        error: null,
      });
      vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
        ok: false,
        error: {
          code: "UNAUTHORIZED",
        },
      });

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(
        activateOrganizationWorkspace("org-7"),
      ).resolves.toBeUndefined();

      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-7",
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to persist preferred organization:",
        {
          code: "UNAUTHORIZED",
        },
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("getAgentJobsBasePath", () => {
    it("returns the jobs base path for agent jobs detail routes", () => {
      expect(getAgentJobsBasePath("/agents/agent-1/jobs/job-9")).toBe(
        "/agents/agent-1/jobs",
      );
    });

    it("returns null for non-agent-jobs routes", () => {
      expect(getAgentJobsBasePath("/tasks")).toBeNull();
    });
  });

  describe("getTaskDetailBasePath", () => {
    it("returns the tasks base path for task detail routes", () => {
      expect(getTaskDetailBasePath("/tasks/task-9")).toBe("/tasks");
    });

    it("returns null for task edit and list routes", () => {
      expect(getTaskDetailBasePath("/tasks")).toBeNull();
      expect(getTaskDetailBasePath("/tasks/new")).toBeNull();
      expect(getTaskDetailBasePath("/tasks/task-9/edit")).toBeNull();
    });
  });

  it("replaces to the jobs base path when current route is inside agent jobs", async () => {
    pathnameMock = "/agents/agent-1/jobs/job-9";
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      data: {
        organizationId: "org-1",
      },
    });

    const user = userEvent.setup();
    render(<WorkspaceSwitcherTestComponent />);

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(updatePreferredOrganization).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(replaceMock).toHaveBeenCalledWith("/agents/agent-1/jobs");
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("replaces to the tasks base path when current route is a task detail", async () => {
    pathnameMock = "/tasks/task-9";
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      data: {
        organizationId: "org-1",
      },
    });

    const user = userEvent.setup();
    render(<WorkspaceSwitcherTestComponent />);

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(updatePreferredOrganization).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(replaceMock).toHaveBeenCalledWith("/tasks");
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("refreshes the current route when outside agent jobs routes", async () => {
    pathnameMock = "/tasks";
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      data: {
        organizationId: "org-1",
      },
    });

    const user = userEvent.setup();
    render(<WorkspaceSwitcherTestComponent />);

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(updatePreferredOrganization).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(refreshMock).toHaveBeenCalled();
      expect(replaceMock).not.toHaveBeenCalled();
    });
  });

  it("supports disabling job route replacement and shows success toast", async () => {
    pathnameMock = "/agents/agent-1/jobs/job-9";
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      data: {
        organizationId: "org-1",
      },
    });

    function WorkspaceSwitcherWithOptionsTestComponent() {
      const { handleSelectWorkspace } = useWorkspaceSwitcher();

      return (
        <button
          type="button"
          onClick={() =>
            handleSelectWorkspace("org-1", {
              shouldRedirectAgentJobsBasePath: false,
              successMessage: "Switched to Org One account",
            })
          }
        >
          Auto switch workspace
        </button>
      );
    }

    const user = userEvent.setup();
    render(<WorkspaceSwitcherWithOptionsTestComponent />);

    await user.click(
      screen.getByRole("button", { name: "Auto switch workspace" }),
    );

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(updatePreferredOrganization).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(replaceMock).not.toHaveBeenCalled();
      expect(refreshMock).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("Switched to Org One account");
    });
  });

  it("supports disabling task detail route replacement", async () => {
    pathnameMock = "/tasks/task-9";
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: true,
      data: {
        organizationId: "org-1",
      },
    });

    function WorkspaceSwitcherWithTaskOptionsTestComponent() {
      const { handleSelectWorkspace } = useWorkspaceSwitcher();

      return (
        <button
          type="button"
          onClick={() =>
            handleSelectWorkspace("org-1", {
              shouldRedirectTaskDetailPath: false,
            })
          }
        >
          Dialog switch workspace
        </button>
      );
    }

    const user = userEvent.setup();
    render(<WorkspaceSwitcherWithTaskOptionsTestComponent />);

    await user.click(
      screen.getByRole("button", { name: "Dialog switch workspace" }),
    );

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(updatePreferredOrganization).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(replaceMock).not.toHaveBeenCalled();
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("keeps the current switch when persisting the preferred organization fails", async () => {
    pathnameMock = "/tasks";
    vi.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
      },
    });

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const user = userEvent.setup();
    render(<WorkspaceSwitcherTestComponent />);

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(updatePreferredOrganization).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(refreshMock).toHaveBeenCalled();
      expect(replaceMock).not.toHaveBeenCalled();
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to persist preferred organization:",
      {
        code: "UNAUTHORIZED",
      },
    );

    consoleErrorSpy.mockRestore();
  });
});
