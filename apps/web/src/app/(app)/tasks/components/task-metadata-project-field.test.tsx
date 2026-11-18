import { expectConsole } from "@sokosumi/utils/test-console";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskMetadataProjectField } from "./task-metadata-project-field";

const setTaskProjectMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/task/property-action", () => ({
  setTaskProject: setTaskProjectMock,
}));

vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.name ? `${key}:${values.name}` : key,
}));

const LAUNCH_BRAND = "https://blob.example/design-md/launch.md";

const OPTIONS = [
  { id: "proj_1", name: "Launch", designMd: { url: LAUNCH_BRAND } },
  {
    id: "proj_2",
    name: "Website",
    designMd: { url: "https://blob.example/design-md/website.md" },
  },
];

/** Launch's brand and briefing are attached; its CONTEXT.md is switched off. */
const LAUNCH_DESCRIPTION = `[DESIGN.md](${LAUNCH_BRAND})\n[BRIEFING.md](https://blob.example/briefing/launch.md)\n\nShip the page`;

let showSaved: (projectId: string | null) => void = () => {};

function renderField(
  projectId: string | null = "proj_1",
  description = LAUNCH_DESCRIPTION,
) {
  const field = (id: string | null) => (
    <TaskMetadataProjectField
      taskId="task-1"
      projectId={id}
      options={OPTIONS}
      context={{ description, defaultBrandUrl: null, userId: "user_1" }}
      labels={{ project: "Project", noProject: "No project" }}
    />
  );
  const view = render(field(projectId));
  showSaved = (id) => view.rerender(field(id));
  return view;
}

/** Saves like the real action: revalidation sends the saved value back. */
function saveLikeServer() {
  setTaskProjectMock.mockImplementation(
    async (input: { projectId: string | null }) => {
      showSaved(input.projectId);
      return { ok: true, value: {} };
    },
  );
}

describe("TaskMetadataProjectField", () => {
  beforeEach(() => {
    setTaskProjectMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("opens a picker instead of navigating, and keeps a separate open link", async () => {
    saveLikeServer();
    renderField();
    const user = userEvent.setup();

    expect(screen.getByRole("link", { name: "open:Launch" })).toHaveAttribute(
      "href",
      "/projects/proj_1",
    );

    await user.click(screen.getByRole("combobox", { name: "Project: Launch" }));
    await user.click(screen.getByRole("option", { name: "Website" }));

    expect(setTaskProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", projectId: "proj_2" }),
    );
    expect(
      screen.getByRole("combobox", { name: "Project: Website" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "open:Website" })).toHaveAttribute(
      "href",
      "/projects/proj_2",
    );
  });

  it("clears the project with No project and drops the open link", async () => {
    saveLikeServer();
    renderField();
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: "Project: Launch" }));
    await user.click(screen.getByRole("option", { name: "No project" }));

    expect(setTaskProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", projectId: null }),
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("sends the Context Core needs to swap the old project's links for the new ones", async () => {
    saveLikeServer();
    renderField();
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: "Project: Launch" }));
    await user.click(screen.getByRole("option", { name: "Website" }));

    expect(setTaskProjectMock.mock.calls[0]?.[0].context).toEqual({
      brand: { enabled: true, source: "project", custom: null },
      briefingEnabled: true,
      contextMdEnabled: false,
    });
  });

  it("turns Briefing and Memory on for a Task joining its first project", async () => {
    saveLikeServer();
    renderField(null, "Ship the page");
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("combobox", { name: "Project: No project" }),
    );
    await user.click(screen.getByRole("option", { name: "Website" }));

    expect(setTaskProjectMock.mock.calls[0]?.[0].context).toMatchObject({
      briefingEnabled: true,
      contextMdEnabled: true,
    });
  });

  it("turns off moves that would leave a links-only Task empty, and says why", async () => {
    renderField("proj_1", "[BRIEFING.md](https://blob.example/briefing/a.md)");
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: "Project: Launch" }));

    expect(screen.getByRole("option", { name: "No project" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("needsDescription")).toBeVisible();
  });

  it("follows a new server value without a remount", () => {
    const { rerender } = renderField();
    const trigger = screen.getByRole("combobox", { name: "Project: Launch" });

    rerender(
      <TaskMetadataProjectField
        taskId="task-1"
        projectId="proj_2"
        options={OPTIONS}
        context={{
          description: LAUNCH_DESCRIPTION,
          defaultBrandUrl: null,
          userId: "user_1",
        }}
        labels={{ project: "Project", noProject: "No project" }}
      />,
    );

    expect(trigger).toHaveAccessibleName("Project: Website");
  });

  it("rolls back and reports when Core refuses", async () => {
    setTaskProjectMock.mockRejectedValue(new Error("boom"));
    expectConsole("error", "Failed to update task project");
    renderField();
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: "Project: Launch" }));
    await user.click(screen.getByRole("option", { name: "Website" }));

    expect(
      await screen.findByRole("combobox", { name: "Project: Launch" }),
    ).not.toHaveAttribute("aria-disabled");
    expect(toastErrorMock).toHaveBeenCalledWith("updateError");
  });
});
