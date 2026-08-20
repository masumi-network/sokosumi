import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrganizationRemoveForm from "@/components/organizations/organization-remove/form";
import type { OrganizationRecord } from "@/lib/clients/generated/core";

const deleteOrganizationMock = vi.fn();
const mockRouterPush = vi.fn();
const mockRouterRefresh = vi.fn();

const translations: Record<string, string> = {
  "Components.Organizations.RemoveModal.cancel": "Cancel",
  "Components.Organizations.RemoveModal.confirm": "Confirm",
  "Components.Organizations.RemoveModal.confirmLabelPrefix": "Type",
  "Components.Organizations.RemoveModal.confirmLabelSuffix":
    "to confirm deletion:",
  "Components.Organizations.RemoveModal.error": "Failed to remove organization",
  "Components.Organizations.RemoveModal.success":
    "Organization removed successfully",
  "Components.Organizations.RemoveModal.blockersTitle":
    "You cannot remove this organization until these are resolved:",
  "Components.Organizations.RemoveModal.preflightError":
    "Could not check whether this organization can be removed.",
  "Components.Organizations.RemoveModal.retry": "Try again",
  "Components.Organizations.RemoveModal.Errors.additionalMembers":
    "Remove all other members before deleting this organization.",
  "Components.Organizations.RemoveModal.Errors.lastWorkspace":
    "You cannot delete your last workspace.",
  "Components.Organizations.RemoveModal.Errors.unauthorizedAction": "Login",
  "Components.Organizations.RemoveModal.Errors.inFlightJob":
    "Wait for in-flight jobs on this organization to finish before deleting it.",
  "Components.Organizations.RemoveModal.Errors.unsettledOnChainJob":
    "Wait for on-chain job purchases on this organization to settle before deleting it.",
  "Components.Organizations.RemoveModal.Errors.inFlightTask":
    "Wait for in-flight tasks on this organization to finish before deleting it.",
  "Components.Organizations.RemoveModal.Links.jobs": "Jobs",
  "Components.Organizations.RemoveModal.Links.tasks": "Tasks",
  "Components.Organizations.RemoveModal.Schema.ConfirmOrganization.invalid":
    "Invalid organization name",
  "Components.Organizations.RemoveModal.Schema.ConfirmOrganization.required":
    "Organization name is required",
  "Components.Organizations.RemoveModal.Schema.ConfirmOrganization.mismatch":
    "Organization name doesn't match",
};

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    refresh: mockRouterRefresh,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    translations[namespace ? `${namespace}.${key}` : key] ??
    (namespace ? `${namespace}.${key}` : key),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialogCancel: ({
    children,
    ...props
  }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  AlertDialogFooter: ({ children }: React.ComponentProps<"div">) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      delete: (...args: unknown[]) => deleteOrganizationMock(...args),
    },
  },
}));

function createOrganization(
  overrides: Partial<OrganizationRecord>,
): OrganizationRecord {
  return {
    id: "org-1",
    name: "Acme",
    slug: "acme",
    logo: null,
    metadata: null,
    stripeCustomerId: null,
    createdAt: new Date("2026-04-15T10:00:00.000Z"),
    ...overrides,
  };
}

describe("OrganizationRemoveForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists mapped blockers and disables confirm while any remain", () => {
    render(
      <OrganizationRemoveForm
        organization={createOrganization({})}
        setIsLoading={vi.fn()}
        onOpenChange={vi.fn()}
        blockers={["ORGANIZATION_HAS_ADDITIONAL_MEMBERS", "LAST_WORKSPACE"]}
      />,
    );

    expect(
      screen.getByText(
        "You cannot remove this organization until these are resolved:",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Remove all other members before deleting this organization.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You cannot delete your last workspace."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("lists in-flight work blockers with way-out links", () => {
    render(
      <OrganizationRemoveForm
        organization={createOrganization({})}
        setIsLoading={vi.fn()}
        onOpenChange={vi.fn()}
        blockers={["IN_FLIGHT_JOB", "UNSETTLED_ON_CHAIN_JOB", "IN_FLIGHT_TASK"]}
      />,
    );

    expect(
      screen.getByText(
        "Wait for in-flight jobs on this organization to finish before deleting it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Wait for on-chain job purchases on this organization to settle before deleting it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Jobs" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Jobs" })[0]).toHaveAttribute(
      "href",
      "/history",
    );
    expect(
      screen.getByText(
        "Wait for in-flight tasks on this organization to finish before deleting it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "href",
      "/tasks",
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("disables confirm and retries preflight when load failed", async () => {
    const user = userEvent.setup();
    render(
      <OrganizationRemoveForm
        organization={createOrganization({})}
        setIsLoading={vi.fn()}
        onOpenChange={vi.fn()}
        blockers={[]}
        preflightFailed
      />,
    );

    expect(
      screen.getByText(
        "Could not check whether this organization can be removed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockRouterRefresh).toHaveBeenCalledOnce();
  });

  it("maps LAST_WORKSPACE if delete is refused after load", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");

    deleteOrganizationMock.mockResolvedValue({
      data: null,
      error: {
        code: "LAST_WORKSPACE",
        message: "Backend fallback",
        status: 400,
        statusText: "Bad Request",
      },
    });

    const { container } = render(
      <OrganizationRemoveForm
        organization={createOrganization({})}
        setIsLoading={vi.fn()}
        onOpenChange={vi.fn()}
        blockers={[]}
      />,
    );

    await user.type(screen.getByRole("textbox"), "Acme");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "You cannot delete your last workspace.",
      );
    });
  });

  it("shows a clear action message when deletion is blocked by additional members", async () => {
    const user = userEvent.setup();
    const setIsLoading = vi.fn();
    const onOpenChange = vi.fn();
    const { toast } = await import("sonner");

    deleteOrganizationMock.mockResolvedValue({
      data: null,
      error: {
        code: "ORGANIZATION_HAS_ADDITIONAL_MEMBERS",
        message: "Backend fallback message",
        status: 400,
        statusText: "Bad Request",
      },
    });

    const { container } = render(
      <OrganizationRemoveForm
        organization={createOrganization({})}
        setIsLoading={setIsLoading}
        onOpenChange={onOpenChange}
      />,
    );

    await user.type(screen.getByRole("textbox"), "Acme");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(deleteOrganizationMock).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Remove all other members before deleting this organization.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(setIsLoading).toHaveBeenNthCalledWith(1, true);
    expect(setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it("redirects to home after successful organization removal", async () => {
    const user = userEvent.setup();
    const setIsLoading = vi.fn();
    const onOpenChange = vi.fn();
    const { toast } = await import("sonner");

    deleteOrganizationMock.mockResolvedValue({
      data: {},
      error: null,
    });

    const { container } = render(
      <OrganizationRemoveForm
        organization={createOrganization({})}
        setIsLoading={setIsLoading}
        onOpenChange={onOpenChange}
      />,
    );

    await user.type(screen.getByRole("textbox"), "Acme");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(deleteOrganizationMock).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
      expect(toast.success).toHaveBeenCalledWith(
        "Organization removed successfully",
      );
      expect(mockRouterPush).toHaveBeenCalledWith("/");
      expect(mockRouterRefresh).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("falls back to the generic delete error for unknown failures", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");

    deleteOrganizationMock.mockResolvedValue({
      data: null,
      error: {
        code: "UNKNOWN",
        message: undefined,
        status: 400,
        statusText: "Bad Request",
      },
    });

    const { container } = render(
      <OrganizationRemoveForm
        organization={createOrganization({})}
        setIsLoading={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox"), "Acme");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to remove organization");
    });
  });
});
