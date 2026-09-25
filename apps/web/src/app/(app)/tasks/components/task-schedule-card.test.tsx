import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TaskSchedule } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import { TaskScheduleCard } from "./task-schedule-card";

const { scheduleDialogMock } = vi.hoisted(() => ({
  scheduleDialogMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join(", ")})` : key,
  useFormatter: () => ({ dateTime: () => "Mon, 9:00" }),
}));

vi.mock("@/components/aurora-orb", () => ({
  AssistantOrb: ({ alt }: { alt?: string }) => (
    <div data-testid="assistant-orb" aria-label={alt} />
  ),
}));

vi.mock("./task-schedule-dialog", () => ({
  TaskScheduleDialog: (props: unknown) => {
    scheduleDialogMock(props);
    return <div role="dialog" aria-label="schedule dialog" />;
  },
}));

const ELENA: CoworkerOption = {
  id: "cow_1",
  slug: "elena",
  name: "Elena",
  image: "",
  kind: "coworker",
  vendor: {
    id: "v1",
    name: "Vendor",
    slug: "vendor",
    logos: { light: null, dark: null },
  },
};

const OWNER: CoworkerOption = {
  ...ELENA,
  id: "user_1",
  slug: "maya",
  name: "Maya",
  kind: "user",
};

const PROJECT = { id: "project_1", name: "Release planning", logo: null };

function schedule(overrides: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    id: "01960001-0001-7001-8001-000000000001",
    workspaceId: "11111111-1111-7111-8111-111111111111",
    organizationId: null,
    ownerId: OWNER.id,
    creatorUserId: OWNER.id,
    creatorCoworkerId: null,
    creatorSokoBotId: null,
    state: "ACTIVE",
    rule: {
      expr: "0 9 * * MON",
      timezone: "UTC",
      intervalDays: null,
      anchorAt: new Date("2030-01-07T09:00:00.000Z"),
      endsMode: "NEVER",
      endsOn: null,
      targetRunCount: null,
    },
    ruleEffectiveFrom: new Date("2030-01-01T00:00:00.000Z"),
    releasedCount: 0,
    nextRunAt: new Date("2030-01-07T09:00:00.000Z"),
    revision: 0,
    name: "Weekly report",
    description: null,
    projectId: null,
    visibility: "PUBLIC",
    assigneeId: ELENA.id,
    assigneeSokoBotId: null,
    assigneeUserId: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<TaskSchedule> = {},
  { currentUserId = OWNER.id }: { currentUserId?: string | null } = {},
) {
  return render(
    <ul>
      <TaskScheduleCard
        assigneeDisplayOptions={[ELENA, OWNER]}
        canCreatePrivate={false}
        coworkerOptions={[ELENA]}
        currentUserId={currentUserId}
        projectOptions={[PROJECT]}
        schedule={schedule(overrides)}
      />
    </ul>,
  );
}

describe("TaskScheduleCard", () => {
  it("shows the rule, the next run, the state, and its assignee", () => {
    renderCard();

    expect(screen.getByRole("link", { name: "Weekly report" })).toHaveAttribute(
      "href",
      "/schedules/01960001-0001-7001-8001-000000000001",
    );
    expect(screen.getByRole("listitem")).toHaveTextContent(
      "option.weeklyWithWeekdayTime",
    );
    expect(screen.getByText("nextRun(Mon, 9:00)")).toBeInTheDocument();
    expect(screen.getByText("state.ACTIVE")).toBeInTheDocument();
    expect(screen.getByTestId("schedule-card-assignee")).toHaveAttribute(
      "title",
      "Elena",
    );
  });

  it("marks a workspace schedule as its own source", () => {
    renderCard();

    expect(screen.getByText("workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("project-avatar")).toBeNull();
  });

  it("names the project a schedule belongs to", () => {
    renderCard({ projectId: PROJECT.id });

    expect(screen.getByText(PROJECT.name)).toBeInTheDocument();
    expect(screen.getByTestId("project-avatar")).toBeInTheDocument();
  });

  it("says when nothing is scheduled and nobody is assigned", () => {
    renderCard({ nextRunAt: null, assigneeId: null });

    expect(screen.getByText("noNextRun")).toBeInTheDocument();
    expect(screen.getByText("unassigned")).toBeInTheDocument();
    expect(screen.queryByTestId("schedule-card-assignee")).toBeNull();
  });

  it("lets the owner edit the schedule in place", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "edit" }));

    expect(
      screen.getByRole("dialog", { name: "schedule dialog" }),
    ).toBeInTheDocument();
    expect(scheduleDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerOptions: [ELENA],
        schedule: expect.objectContaining({ name: "Weekly report" }),
      }),
    );
  });

  it("opens from anywhere on the card, with the edit left clickable", () => {
    renderCard();

    // One link per card, stretched over it — not a link per element.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Weekly report" }).className,
    ).toMatch(/after:inset-0/);
    expect(screen.getByRole("button", { name: "edit" }).className).toMatch(
      /z-10/,
    );
  });

  it("offers no edit to anyone but the owner", () => {
    renderCard({}, { currentUserId: "user_other" });

    expect(screen.queryByRole("button", { name: "edit" })).toBeNull();
  });
});
