import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import type { PendingInvitationDetail } from "@/lib/services/organization.service";

import InvitationCard from "./invitation-card";

vi.mock("./invitation-actions", () => ({
  default: () => <div data-testid="invitation-actions" />,
}));

const messages = {
  AcceptInvitation: {
    InvitationCard: {
      title: "You've been invited",
      invitedToJoin: "Join {organization} on Sokosumi.",
      acceptedTitle: "Welcome to {organizationName}!",
      acceptedDescription: "You've successfully joined the organization.",
      goToOrganization: "Go to Organization",
      declinedTitle: "Invitation Declined",
      declinedDescription:
        "You've declined the invitation to join {organizationName}.",
      goToHome: "Go to Home",
    },
  },
};

const pendingInvitation: PendingInvitationDetail = {
  id: "inv_1",
  organizationId: "org_1",
  email: "ada@example.com",
  role: "member",
  status: "pending",
  expiresAt: new Date("2026-09-01T00:00:00.000Z"),
  inviterId: "user_2",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  organization: { id: "org_1", name: "Acme", slug: "acme" },
  inviter: { id: "user_2", email: "owner@example.com" },
};

function renderCard(invitation: PendingInvitationDetail = pendingInvitation) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InvitationCard invitation={invitation} />
    </NextIntlClientProvider>,
  );
}

describe("InvitationCard pending look", () => {
  it("uses join's invited-to language and does not show the inviter", () => {
    renderCard();

    expect(screen.getByText("You've been invited")).toBeVisible();
    expect(screen.getByText("Join Acme on Sokosumi.")).toBeVisible();
    expect(screen.queryByText("owner@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("has invited you.")).not.toBeInTheDocument();
    expect(screen.getByTestId("invitation-actions")).toBeVisible();
    expect(
      screen.queryByText("You've been invited to join an organization"),
    ).not.toBeInTheDocument();
  });

  it("still renders invitation-only accepted and rejected states", () => {
    const { rerender } = renderCard({
      ...pendingInvitation,
      status: "accepted",
    });

    expect(screen.getByText("Welcome to Acme!")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Go to Organization" }),
    ).toHaveAttribute("href", "/organizations/acme");

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <InvitationCard
          invitation={{ ...pendingInvitation, status: "rejected" }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Invitation Declined")).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
