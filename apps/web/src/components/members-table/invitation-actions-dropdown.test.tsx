import type { PendingInvitation } from "@sokosumi/core-client";
import { MemberRole } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationMembershipSelf } from "@/lib/types/core-dto";

import InvitationActionsDropdown from "./invitation-actions-dropdown";
import { InvitationActionsModalContextProvider } from "./invitation-actions-modal-context";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const { inviteMemberMock, refreshMock } = vi.hoisted(() => ({
  inviteMemberMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { organization: { inviteMember: inviteMemberMock } },
}));

describe("InvitationActionsDropdown", () => {
  it("reports a failed resend as a failure only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    inviteMemberMock.mockResolvedValue({ error: { message: "rate limited" } });

    render(
      <InvitationActionsModalContextProvider>
        <InvitationActionsDropdown
          me={{ role: MemberRole.ADMIN } as OrganizationMembershipSelf}
          invitation={
            {
              id: "invitation-1",
              email: "guest@example.com",
              organizationId: "org-1",
            } as PendingInvitation
          }
        />
      </InvitationActionsModalContextProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "resend" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("resendError");
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
