import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeleteAccountForm } from "../delete-account-form";

const deleteUserMock = vi.fn();
const mockRouterPush = vi.fn();
const mockRouterRefresh = vi.fn();

const translations: Record<string, string> = {
  "App.Account.Delete.title": "Delete account",
  "App.Account.Delete.description": "Permanently delete your account",
  "App.Account.Delete.button": "Delete account",
  "App.Account.Delete.confirmTitle": "Are you sure?",
  "App.Account.Delete.confirmDescription": "This cannot be undone.",
  "App.Account.Delete.currentPassword": "Current password",
  "App.Account.Delete.confirm": "Yes, delete my account",
  "App.Account.Delete.success": "Account deleted successfully",
  "App.Account.Delete.error": "Failed to delete account",
  "App.Account.Delete.blockersTitle":
    "You cannot delete your account until these are resolved:",
  "App.Account.Delete.preflightError":
    "Could not check whether your account can be deleted.",
  "App.Account.Delete.retry": "Try again",
  "App.Account.Delete.Errors.taskPaymentClaimPending":
    "Wait for pending task payments to settle before deleting your account.",
  "App.Account.Delete.Errors.taskPaymentClaimReviewRequired":
    "A task payment needs administrator review before your account can be deleted. Please contact support.",
  "App.Account.Delete.Errors.userOwnsOrganization":
    "Transfer ownership or delete every organization you own before deleting your account.",
  "App.Account.Delete.Errors.inFlightJob":
    "Wait for in-flight jobs to finish before deleting your account.",
  "App.Account.Delete.Errors.unsettledOnChainJob":
    "Wait for on-chain job purchases to settle before deleting your account.",
  "App.Account.Delete.Errors.inFlightTask":
    "Wait for in-flight tasks to finish before deleting your account.",
  "App.Account.Delete.Errors.runningSubscription":
    "Cancel your running subscription and wait until the paid period ends.",
  "App.Account.Delete.Errors.billingLink": "Go to billing",
  "App.Account.Delete.Links.organizationMembers": "Organization members",
  "App.Account.Delete.Links.jobs": "Jobs",
  "App.Account.Delete.Links.tasks": "Tasks",
  "Library.Auth.Schema.Password.required": "Password is required",
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

vi.mock("@/lib/auth/auth.client", () => ({
  deleteUser: (...args: unknown[]) => deleteUserMock(...args),
}));

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Delete account" }));
  return user;
}

describe("DeleteAccountForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists mapped blockers and disables confirm while any remain", async () => {
    render(
      <DeleteAccountForm
        blockers={[
          "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
          "TASK_PAYMENT_CLAIM_PENDING",
        ]}
      />,
    );

    await openDialog();

    expect(
      screen.getByText(
        "You cannot delete your account until these are resolved:",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A task payment needs administrator review before your account can be deleted. Please contact support.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Wait for pending task payments to settle before deleting your account.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Yes, delete my account" }),
    ).toBeDisabled();
  });

  it("lists a running-subscription blocker with a billing link and disables confirm", async () => {
    render(<DeleteAccountForm blockers={["RUNNING_SUBSCRIPTION"]} />);

    await openDialog();

    expect(
      screen.getByText(
        "Cancel your running subscription and wait until the paid period ends.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to billing" })).toHaveAttribute(
      "href",
      "/billing",
    );
    expect(
      screen.getByRole("button", { name: "Yes, delete my account" }),
    ).toBeDisabled();
  });

  it("lists owner-role and in-flight work blockers with way-out links", async () => {
    render(
      <DeleteAccountForm
        blockers={[
          "USER_OWNS_ORGANIZATION",
          "IN_FLIGHT_JOB",
          "UNSETTLED_ON_CHAIN_JOB",
          "IN_FLIGHT_TASK",
        ]}
        ownedOrganizationSlug="acme"
      />,
    );

    await openDialog();

    expect(
      screen.getByText(
        "Transfer ownership or delete every organization you own before deleting your account.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Organization members" }),
    ).toHaveAttribute("href", "/organizations/acme");
    expect(
      screen.getByText(
        "Wait for in-flight jobs to finish before deleting your account.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Wait for on-chain job purchases to settle before deleting your account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Jobs" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Jobs" })[0]).toHaveAttribute(
      "href",
      "/history",
    );
    expect(
      screen.getByText(
        "Wait for in-flight tasks to finish before deleting your account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "href",
      "/tasks",
    );
    expect(
      screen.getByRole("button", { name: "Yes, delete my account" }),
    ).toBeDisabled();
  });

  it("disables confirm when preflight failed to load", async () => {
    render(<DeleteAccountForm blockers={[]} preflightFailed />);

    await openDialog();

    expect(
      screen.getByText("Could not check whether your account can be deleted."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Yes, delete my account" }),
    ).toBeDisabled();
  });

  it("retries preflight by refreshing the page", async () => {
    render(<DeleteAccountForm blockers={[]} preflightFailed />);

    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(mockRouterRefresh).toHaveBeenCalledOnce();
  });

  it("maps the same codes if delete is refused after load", async () => {
    const { toast } = await import("sonner");
    deleteUserMock.mockResolvedValue({
      error: {
        code: "TASK_PAYMENT_CLAIM_PENDING",
        message: "Backend fallback",
        status: 400,
        statusText: "Bad Request",
      },
    });

    render(<DeleteAccountForm blockers={[]} />);

    const user = await openDialog();
    await user.type(screen.getByLabelText("Current password"), "Password123!");
    await user.click(
      screen.getByRole("button", { name: "Yes, delete my account" }),
    );

    await waitFor(() => {
      expect(deleteUserMock).toHaveBeenCalledWith({
        password: "Password123!",
      });
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Wait for pending task payments to settle before deleting your account.",
    );
  });
});
