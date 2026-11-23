import type {
  OrganizationDeletionEvaluation,
  OrganizationRecord,
} from "@sokosumi/core-client";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import OrganizationRemoveModal from "@/components/organizations/organization-remove/modal";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    [key, ...Object.values(values ?? {})].join(" "),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { organization: { delete: vi.fn() } },
}));

const organization = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
  logo: null,
  metadata: null,
  stripeCustomerId: null,
  createdAt: new Date("2026-04-15T10:00:00.000Z"),
} as OrganizationRecord;

function Page({
  blockers,
  active = true,
  otherMemberCount = 11,
}: {
  blockers: OrganizationDeletionEvaluation["blockers"];
  active?: boolean;
  otherMemberCount?: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <section id="members" tabIndex={-1}>
        members
      </section>
      <OrganizationRemoveModal
        open={open}
        onOpenChange={setOpen}
        organization={organization}
        blockers={blockers}
        otherMemberCount={otherMemberCount}
        isActiveOrganization={active}
      />
    </>
  );
}

describe("OrganizationRemoveModal when deletion is blocked", () => {
  it("names the organization, counts members, links each blocker and offers only Close", () => {
    render(
      <Page
        blockers={[
          "ORGANIZATION_HAS_ADDITIONAL_MEMBERS",
          "RUNNING_SUBSCRIPTION",
          "IN_FLIGHT_JOB",
          "IN_FLIGHT_TASK",
          "LAST_WORKSPACE",
        ]}
      />,
    );
    const dialog = screen.getByRole("alertdialog");

    expect(
      within(dialog).getByRole("heading", { name: "title Acme" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent("additionalMembers 11");
    expect(dialog).toHaveTextContent("lastWorkspace");
    expect(
      within(dialog).getByRole("link", { name: "Links.members" }),
    ).toHaveAttribute("href", "#members");
    expect(
      within(dialog).getByRole("link", { name: "Links.billing" }),
    ).toHaveAttribute("href", "/billing?organizationId=org-1");
    expect(
      within(dialog).getByRole("link", { name: "Links.jobs" }),
    ).toHaveAttribute("href", "/history?scope=workspace");
    expect(
      within(dialog).getByRole("link", { name: "Links.tasks" }),
    ).toHaveAttribute("href", "/tasks");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["close"]);
  });

  it("closes and moves focus to the members list from Go to members", async () => {
    render(<Page blockers={["ORGANIZATION_HAS_ADDITIONAL_MEMBERS"]} />);

    await userEvent.click(screen.getByRole("link", { name: "Links.members" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(document.getElementById("members"));
  });
});

describe("OrganizationRemoveModal for an organization that is not the active workspace", () => {
  it("keeps billing scoped to it and gives guidance instead of jobs and tasks links", () => {
    render(
      <Page
        active={false}
        blockers={["RUNNING_SUBSCRIPTION", "IN_FLIGHT_JOB", "IN_FLIGHT_TASK"]}
      />,
    );
    const dialog = screen.getByRole("alertdialog");

    expect(
      within(dialog).getByRole("link", { name: "Links.billing" }),
    ).toHaveAttribute("href", "/billing?organizationId=org-1");
    expect(
      within(dialog).queryByRole("link", { name: "Links.jobs" }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("link", { name: "Links.tasks" }),
    ).toBeNull();
    expect(within(dialog).getAllByText("switchWorkspace")).toHaveLength(2);
  });
});

describe("OrganizationRemoveModal when nothing blocks", () => {
  it("still asks to type the name before Confirm", async () => {
    await act(async () => render(<Page blockers={[]} />));
    const dialog = screen.getByRole("alertdialog");

    expect(within(dialog).getByRole("textbox")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "confirm" }),
    ).toBeDisabled();
  });
});
