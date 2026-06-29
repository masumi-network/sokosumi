import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskWorkspaceSwitchDialog } from "@/app/tasks/components/task-workspace-switch-dialog";
import { updatePreferredOrganization } from "@/lib/actions/organization";
import { authClient } from "@/lib/auth/auth.client";
import type { OrganizationRecord } from "@/lib/clients/generated/core";

const backMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/task_123",
  useRouter: () => ({
    back: backMock,
    push: pushMock,
    refresh: refreshMock,
    replace: replaceMock,
  }),
}));

interface RichValues {
  account?: ReactNode;
  accountName?: (chunks: ReactNode) => ReactNode;
  taskName?: string;
}

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, string>) => {
      if (key === "title") {
        return "This task was created in another workspace";
      }
      if (key === "avatarTransition") {
        return `From ${values?.currentAccount} to ${values?.targetAccount}`;
      }
      if (key === "description") {
        return `${values?.taskName} belongs to ${values?.account}`;
      }
      if (key === "cancel") return "Stay here";
      if (key === "confirm") return "Switch workspace";
      return key;
    };
    t.rich = (key: string, values?: RichValues) => {
      if (key === "description") {
        const account =
          typeof values?.accountName === "function"
            ? values.accountName(values.account)
            : values?.account;

        return (
          <>
            {values?.taskName} belongs to {account}
          </>
        );
      }

      return key;
    };
    return t;
  },
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

const sessionUser = {
  createdAt: "2025-01-01T00:00:00.000Z",
  email: "francis@example.com",
  emailVerified: true,
  id: "user_123",
  image: null,
  marketingOptIn: false,
  name: "Francis",
  onboardingCompleted: true,
  termsAccepted: true,
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const targetOrganization: OrganizationRecord = {
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  id: "org_123",
  logo: null,
  metadata: null,
  name: "Acme",
  slug: "acme",
  stripeCustomerId: null,
};

const defaultProps = {
  currentAccountName: "Personal Account",
  currentOrganization: null,
  sessionUser,
  taskName: "Quarterly report",
  targetAccountName: "Acme",
  targetOrganization,
  targetOrganizationId: "org_123",
  successMessage: "Switched to Acme account",
};

describe("TaskWorkspaceSwitchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authClient.organization.setActive).mockResolvedValue({
      data: null,
      error: null,
    });
    vi.mocked(updatePreferredOrganization).mockResolvedValue({
      ok: true,
      data: {
        organizationId: "org_123",
      },
    });

    Object.defineProperty(window.history, "length", {
      configurable: true,
      value: 2,
    });
  });

  it("does not switch workspaces on mount", () => {
    render(<TaskWorkspaceSwitchDialog {...defaultProps} />);

    expect(authClient.organization.setActive).not.toHaveBeenCalled();
    expect(updatePreferredOrganization).not.toHaveBeenCalled();
    expect(
      screen.getByText("This task was created in another workspace"),
    ).toBeInTheDocument();
    expect(screen.getByText("Acme")).toHaveClass("font-semibold");
    expect(
      screen.getByLabelText("From Personal Account to Acme"),
    ).toBeInTheDocument();
  });

  it("switches workspace and refreshes the task route on confirm", async () => {
    render(<TaskWorkspaceSwitchDialog {...defaultProps} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Switch workspace",
      }),
    );

    await waitFor(() => {
      expect(authClient.organization.setActive).toHaveBeenCalledWith({
        organizationId: "org_123",
      });
      expect(updatePreferredOrganization).toHaveBeenCalledWith({
        organizationId: "org_123",
      });
      expect(refreshMock).toHaveBeenCalled();
    });

    expect(pushMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("goes back when the user cancels", () => {
    render(<TaskWorkspaceSwitchDialog {...defaultProps} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Stay here",
      }),
    );

    expect(backMock).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
