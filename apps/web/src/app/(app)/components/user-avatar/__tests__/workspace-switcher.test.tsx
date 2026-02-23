import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  getAgentJobsBasePath,
  useWorkspaceSwitcher,
} from "@/app/components/user-avatar/workspace-switcher";
import { authClient } from "@/lib/auth/auth.client";
import { toast } from "sonner";

const replaceMock = jest.fn();
const refreshMock = jest.fn();
let pathnameMock = "/";

jest.mock("next/navigation", () => ({
  usePathname: () => pathnameMock,
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
}));

jest.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      setActive: jest.fn(),
    },
  },
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
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
    jest.mocked(authClient.organization.setActive).mockReset();
    jest.mocked(toast.success).mockReset();
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

  it("replaces to the jobs base path when current route is inside agent jobs", async () => {
    pathnameMock = "/agents/agent-1/jobs/job-9";
    jest.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const user = userEvent.setup();
    render(<WorkspaceSwitcherTestComponent />);

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(replaceMock).toHaveBeenCalledWith("/agents/agent-1/jobs");
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("refreshes the current route when outside agent jobs routes", async () => {
    pathnameMock = "/tasks";
    jest.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const user = userEvent.setup();
    render(<WorkspaceSwitcherTestComponent />);

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(refreshMock).toHaveBeenCalled();
      expect(replaceMock).not.toHaveBeenCalled();
    });
  });

  it("supports disabling job route replacement and shows success toast", async () => {
    pathnameMock = "/agents/agent-1/jobs/job-9";
    jest.mocked(authClient.organization.setActive).mockResolvedValueOnce({
      data: null,
      error: null,
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
      expect(replaceMock).not.toHaveBeenCalled();
      expect(refreshMock).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("Switched to Org One account");
    });
  });
});
