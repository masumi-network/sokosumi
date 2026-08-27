import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceGateErrorCode } from "@/lib/actions/errors";

import { DeletePersonalWorkspaceForm } from "./delete-personal-workspace-form";

const deletePersonalWorkspaceActionMock = vi.fn();
const activateOrganizationWorkspaceMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/actions/workspace-gate", () => ({
  deletePersonalWorkspaceAction: (...args: unknown[]) =>
    deletePersonalWorkspaceActionMock(...args),
}));

vi.mock("@/lib/activate-organization-workspace", () => ({
  activateOrganizationWorkspace: (...args: unknown[]) =>
    activateOrganizationWorkspaceMock(...args),
}));

async function confirmDelete() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "button" }));
  await user.click(screen.getByRole("button", { name: "confirm" }));
}

describe("DeletePersonalWorkspaceForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deletePersonalWorkspaceActionMock.mockResolvedValue({
      ok: true,
      value: { workspaceId: "ws-1" },
    });
    activateOrganizationWorkspaceMock.mockResolvedValue(undefined);
  });

  it("does not switch org when the user is already in one", async () => {
    render(
      <DeletePersonalWorkspaceForm
        hasOrganizationMembership={true}
        fallbackOrganizationId="org-fallback"
        currentOrganizationId="org-a"
      />,
    );

    await confirmDelete();

    await waitFor(() => {
      expect(deletePersonalWorkspaceActionMock).toHaveBeenCalledOnce();
    });
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();
    expect(routerRefreshMock).toHaveBeenCalledOnce();
  });

  it("activates the fallback org when deleting from personal context", async () => {
    render(
      <DeletePersonalWorkspaceForm
        hasOrganizationMembership={true}
        fallbackOrganizationId="org-fallback"
        currentOrganizationId={null}
      />,
    );

    await confirmDelete();

    await waitFor(() => {
      expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith(
        "org-fallback",
      );
    });
    expect(toast.success).toHaveBeenCalledWith("success");
    expect(routerRefreshMock).toHaveBeenCalledOnce();
  });

  it("toasts success when fallback org activation succeeds on retry", async () => {
    activateOrganizationWorkspaceMock
      .mockRejectedValueOnce(new Error("setActive failed"))
      .mockResolvedValueOnce(undefined);

    render(
      <DeletePersonalWorkspaceForm
        hasOrganizationMembership={true}
        fallbackOrganizationId="org-fallback"
        currentOrganizationId={null}
      />,
    );

    await confirmDelete();

    await waitFor(() => {
      expect(activateOrganizationWorkspaceMock).toHaveBeenCalledTimes(2);
    });
    expect(toast.success).toHaveBeenCalledWith("success");
    expect(toast.error).not.toHaveBeenCalled();
    expect(routerRefreshMock).toHaveBeenCalledOnce();
  });

  it("does not toast success when fallback org activation fails", async () => {
    activateOrganizationWorkspaceMock.mockRejectedValue(
      new Error("setActive failed"),
    );

    render(
      <DeletePersonalWorkspaceForm
        hasOrganizationMembership={true}
        fallbackOrganizationId="org-fallback"
        currentOrganizationId={null}
      />,
    );

    await confirmDelete();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("activateError");
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(routerRefreshMock).toHaveBeenCalledOnce();
  });

  it("does not activate fallback when last-workspace delete is refused", async () => {
    deletePersonalWorkspaceActionMock.mockResolvedValue({
      ok: false,
      error: { code: WorkspaceGateErrorCode.LAST_WORKSPACE },
    });

    render(
      <DeletePersonalWorkspaceForm
        hasOrganizationMembership={true}
        fallbackOrganizationId="org-fallback"
        currentOrganizationId={null}
      />,
    );

    await confirmDelete();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("lastWorkspaceError");
    });
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();
    expect(routerRefreshMock).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not activate fallback when the workspace still has dependents", async () => {
    deletePersonalWorkspaceActionMock.mockResolvedValue({
      ok: false,
      error: { code: WorkspaceGateErrorCode.WORKSPACE_HAS_DEPENDENTS },
    });

    render(
      <DeletePersonalWorkspaceForm
        hasOrganizationMembership={true}
        fallbackOrganizationId="org-fallback"
        currentOrganizationId={null}
      />,
    );

    await confirmDelete();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("dependentsError");
    });
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();
    expect(routerRefreshMock).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not activate fallback when deletion fails generically", async () => {
    deletePersonalWorkspaceActionMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR" },
    });

    render(
      <DeletePersonalWorkspaceForm
        hasOrganizationMembership={true}
        fallbackOrganizationId="org-fallback"
        currentOrganizationId={null}
      />,
    );

    await confirmDelete();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("error");
    });
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();
    expect(routerRefreshMock).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
