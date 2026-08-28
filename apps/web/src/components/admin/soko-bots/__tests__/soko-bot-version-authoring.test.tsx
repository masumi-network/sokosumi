import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, pushMock, refreshMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      "Actions.archive": "Archive",
      "Actions.archiveDefaultHint":
        "Promote another version before archiving this default.",
      "Actions.cancel": "Cancel",
      "Actions.promote": "Promote",
      "Actions.promoteConfirm":
        "This affects new bots only. Existing bots keep the version they were created on.",
      "Actions.promoteTitle": "Promote this version?",
      "Form.allRouteTools": "Every tool allowed by the route",
      "Form.gatewayModels": "Browse gateway models",
      "Form.model": "Model",
      "Form.name": "Name",
      "Form.noGatewayModels": "No gateway models reported. Enter a model ID.",
      "Form.region": "Inference region",
      "Form.slug": "Version ID",
      "Form.summary": "Summary",
      "Form.systemPrompt": "System prompt",
      "Form.tools": "Tools",
      "Form.skills": "Skills",
      "Values.eu": "EU",
    })[key] ?? key,
}));

vi.mock("next-intl/server", () => ({
  getFormatter: vi.fn(async () => ({
    dateTime: (value: Date) => value.toISOString().slice(0, 10),
    number: (value: number) => String(value),
  })),
  getTranslations: vi.fn(
    async () => (key: string) =>
      ({
        "Actions.duplicate": "Duplicate",
        "Actions.edit": "Edit",
        "Actions.testInLab": "Test in lab",
        "Actions.view": "View",
        "Detail.avgScore": "Average score",
        "Detail.builtInReadOnly":
          "Built-in versions are read-only because code owns them. Duplicate this version to customize it.",
        "Detail.judged": "Judged",
        "Detail.labHistory": "Lab history",
        "Detail.neverRunInLab": "No lab runs recorded.",
        "Detail.prompt": "System prompt",
        "Detail.realRuns": "Real runs",
        "Detail.tools": "Tools",
        "Detail.turns": "Turns",
        "List.model": "Model",
        "List.region": "Region",
        "List.version": "Version",
        "State.authored": "Authored",
        "State.builtIn": "Built-in",
        "State.default": "Default",
        "Values.allRouteTools": "Every tool allowed by the route",
        "Values.eu": "EU",
        "Values.judgePass": "Passed",
        "Values.noRegion": "None",
      })[key] ?? key,
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions/admin-soko-bots/action", () => ({
  archiveAdminSokoBotVersionAction: vi.fn(),
  createAdminSokoBotVersionAction: (...args: unknown[]) => createMock(...args),
  promoteAdminSokoBotVersionAction: vi.fn(),
  updateAdminSokoBotVersionAction: vi.fn(),
}));

import type {
  AdminSokoBotQuality,
  SokoBotLabRun,
  SokoBotVersionDetail as VersionDetail,
} from "@/lib/clients/generated/core";
import { SokoBotVersionActions } from "../soko-bot-version-actions.client";
import { SokoBotVersionDetail } from "../soko-bot-version-detail";
import { SokoBotVersionForm } from "../soko-bot-version-form.client";
import { SokoBotVersionList } from "../soko-bot-version-list";

const BUILT_IN_VERSION: VersionDetail = {
  id: "v11",
  name: "Soko Bot v11",
  createdAt: "2026-08-01",
  summary: "Production project manager.",
  model: "anthropic/claude-sonnet-4.5",
  inferenceRegion: "eu",
  systemPrompt: "Manage the owner's work carefully.",
  skills: ["project-manager"],
  capabilities: ["tasks.read", "tasks.write"],
  authored: false,
  isDefault: true,
};

const AUTHORED_VERSION: VersionDetail = {
  ...BUILT_IN_VERSION,
  id: "v12-operator",
  name: "Operator",
  authored: true,
  isDefault: false,
};

const QUALITY: AdminSokoBotQuality = {
  overall: { turns: 12, judged: 10, avgScore: 4.2 },
  proactive: { sent: 3, actedOn: 2, thumbsUp: 2, thumbsDown: 1 },
  daily: [],
  versions: [
    { versionId: "v11", name: "Soko Bot v11", turns: 12, avgScore: 4.2 },
  ],
};

const LAB_RUN: SokoBotLabRun = {
  id: "lab-run-1",
  turnId: "00000000-0000-4000-8000-000000000001",
  scenarioId: "delegate-work",
  versionId: "v11",
  passed: 4,
  total: 5,
  checks: [{ label: "Delegated", pass: true, actual: "Created one task" }],
  judge: {
    scores: { delegation: 5, followThrough: 4, judgment: 4, honesty: 5 },
    verdict: "pass",
    rationale: "Handled the scenario well.",
    issues: [],
  },
  judgeModel: "judge/model",
  durationMs: 1200,
  costUsd: 0.02,
  createdAt: new Date("2026-08-27T10:00:00Z"),
};

describe("Soko Bot version authoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows default and ownership state with Duplicate instead of Edit for built-ins", async () => {
    render(
      await SokoBotVersionList({
        versions: [BUILT_IN_VERSION, AUTHORED_VERSION],
      }),
    );

    const builtInRow = screen.getByRole("row", { name: /Soko Bot v11/ });
    expect(within(builtInRow).getByText("Default")).toBeInTheDocument();
    expect(within(builtInRow).getByText("Built-in")).toBeInTheDocument();
    expect(within(builtInRow).getByText("EU")).toBeInTheDocument();
    expect(
      within(builtInRow).getByRole("link", { name: "Duplicate" }),
    ).toHaveAttribute("href", "/admin/soko-bots/versions/new?from=v11");
    expect(
      within(builtInRow).queryByRole("link", { name: "Edit" }),
    ).not.toBeInTheDocument();

    const authoredRow = screen.getByRole("row", { name: /Operator/ });
    expect(within(authoredRow).getByText("Authored")).toBeInTheDocument();
    expect(
      within(authoredRow).getByRole("link", { name: "Edit" }),
    ).toHaveAttribute(
      "href",
      "/admin/soko-bots/versions/v12-operator?mode=edit",
    );
  });

  it("makes a default built-in visibly read-only on its detail view", async () => {
    render(
      await SokoBotVersionDetail({
        version: BUILT_IN_VERSION,
        quality: QUALITY,
        labRuns: [LAB_RUN],
      }),
    );

    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Built-in versions are read-only because code owns them. Duplicate this version to customize it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("delegate-work")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
  });

  it("duplicates every built-in field while leaving the slug blank", () => {
    render(
      <SokoBotVersionForm
        mode="create"
        initialVersion={BUILT_IN_VERSION}
        gatewayModels={[]}
        availableSkills={[
          {
            id: "project-manager",
            name: "Project manager",
            description: "Plans and follows up on work.",
            installed: false,
          },
        ]}
        availableCapabilities={["tasks.read", "tasks.write"]}
      />,
    );

    expect(screen.getByLabelText("Version ID")).toHaveValue("");
    expect(screen.getByLabelText("Name")).toHaveValue("Soko Bot v11");
    expect(screen.getByLabelText("Summary")).toHaveValue(
      "Production project manager.",
    );
    expect(screen.getByLabelText("Model")).toHaveValue(
      "anthropic/claude-sonnet-4.5",
    );
    expect(
      screen.getByRole("combobox", { name: "Inference region" }),
    ).toHaveTextContent("EU");
    expect(screen.getByLabelText("System prompt")).toHaveValue(
      "Manage the owner's work carefully.",
    );
    expect(
      screen.getByRole("checkbox", { name: /Project manager/ }),
    ).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "tasks.read" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "tasks.write" })).toBeChecked();
    expect(
      screen.getByText("No gateway models reported. Enter a model ID."),
    ).toBeInTheDocument();
  });

  it("keeps the model editable and explains that empty tools allow the route ceiling", () => {
    render(
      <SokoBotVersionForm
        mode="create"
        initialVersion={{ ...BUILT_IN_VERSION, capabilities: [] }}
        gatewayModels={[]}
        availableSkills={[]}
        availableCapabilities={["tasks.read"]}
      />,
    );

    const model = screen.getByLabelText("Model");
    fireEvent.change(model, { target: { value: "custom/model" } });
    expect(model).toHaveValue("custom/model");
    expect(
      screen.getByText("Every tool allowed by the route"),
    ).toBeInTheDocument();
  });

  it("states the new-bots-only effect before promotion", () => {
    render(<SokoBotVersionActions version={AUTHORED_VERSION} />);

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "This affects new bots only. Existing bots keep the version they were created on.",
    );
  });

  it("requires replacing the default before an authored version can be archived", () => {
    render(
      <SokoBotVersionActions
        version={{ ...AUTHORED_VERSION, isDefault: true }}
      />,
    );

    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    expect(
      screen.getByText(
        "Promote another version before archiving this default.",
      ),
    ).toBeInTheDocument();
  });
});
