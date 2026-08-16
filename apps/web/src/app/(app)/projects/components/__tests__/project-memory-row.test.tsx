import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectMemoryRow } from "@/app/projects/components/project-memory-row";
import { getProjectContextMd } from "@/lib/actions/project/action";

vi.mock("@/lib/actions/project/action", () => ({
  getProjectContextMd: vi.fn(),
}));

const MESSAGES: Record<string, string> = {
  "memory.fileName": "Memory",
  "memory.updated": "Updated {when}",
  "memory.updating": "Updating…",
  "memory.loading": "Loading…",
  "memory.empty": "Builds as tasks complete",
  "memory.modelLine": "{model} · hosted in the EU 🇪🇺",
  "memory.defaultModel": "Mistral Medium",
  "memory.notConfigured": "Not configured (AI_GATEWAY_API_KEY)",
  "memory.title": "Project memory",
  "memory.copyLink": "Copy link",
  "memory.openRaw": "Open raw",
  "memory.copied": "Copied",
  "errors.contextMd": "Couldn't load memory",
};

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    relativeTime: () => "2 hours ago",
  }),
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (message, [name, value]) => message.replace(`{${name}}`, value),
      MESSAGES[key] ?? key,
    ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("ProjectMemoryRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state as a non-interactive stat card", () => {
    render(
      <ProjectMemoryRow
        projectId="project-1"
        contextMd={null}
        contextMdUpdating={false}
      />,
    );

    expect(screen.getByTestId("project-memory-empty")).toHaveTextContent(
      "MemoryBuilds as tasks completeMistral Medium · hosted in the EU 🇪🇺",
    );
    expect(screen.queryByTestId("project-memory-row")).not.toBeInTheDocument();
  });

  it("shows a muted hint when memory updates are disabled", () => {
    render(
      <ProjectMemoryRow
        projectId="project-1"
        contextMd={null}
        contextMdUpdating={false}
        memoryEnabled={false}
      />,
    );

    expect(screen.getByTestId("project-memory-disabled")).toHaveTextContent(
      "Not configured (AI_GATEWAY_API_KEY)",
    );
  });

  it("shows an updating pulse when memory is rewriting", () => {
    render(
      <ProjectMemoryRow
        projectId="project-1"
        contextMd={null}
        contextMdUpdating
      />,
    );

    expect(screen.getByTestId("project-memory-updating")).toBeInTheDocument();
    expect(screen.getByTestId("project-memory-row")).toHaveTextContent(
      "MemoryBuilds as tasks completeMistral Medium · hosted in the EU 🇪🇺",
    );
  });

  it("opens the read-only dialog and loads context markdown", async () => {
    const user = userEvent.setup();
    const getProjectContextMdMock = vi.mocked(getProjectContextMd);
    getProjectContextMdMock.mockResolvedValue({
      content: "# Memory\nLearned the voice.",
      url: "https://blob.example/CONTEXT.md",
      updatedAt: new Date("2026-08-16T10:00:00.000Z"),
      version: 2,
      model: {
        id: "mistral/mistral-medium-latest",
        label: "Mistral Medium",
        region: "eu",
      },
      lineCount: 12,
    });

    render(
      <ProjectMemoryRow
        projectId="project-1"
        contextMd={{
          url: "https://blob.example/CONTEXT.md",
          updatedAt: new Date("2026-08-16T10:00:00.000Z"),
          version: 2,
          model: {
            id: "mistral/mistral-medium-latest",
            label: "Mistral Medium",
            region: "eu",
          },
          lineCount: 12,
        }}
        contextMdUpdating={false}
      />,
    );

    expect(screen.getByText("Updated 2 hours ago")).toBeInTheDocument();
    await user.click(screen.getByTestId("project-memory-row"));

    await waitFor(() => {
      expect(getProjectContextMdMock).toHaveBeenCalledWith({
        projectId: "project-1",
      });
    });
    expect(await screen.findByText("Learned the voice.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open raw" })).toHaveAttribute(
      "href",
      "https://blob.example/CONTEXT.md",
    );
  });

  it("shows a loading label while memory content is fetched", async () => {
    const user = userEvent.setup();
    vi.mocked(getProjectContextMd).mockReturnValue(new Promise(() => {}));

    render(
      <ProjectMemoryRow
        projectId="project-1"
        contextMd={{
          url: "https://blob.example/CONTEXT.md",
          updatedAt: new Date("2026-08-16T10:00:00.000Z"),
          version: 2,
          model: {
            id: "mistral/mistral-medium-latest",
            label: "Mistral Medium",
            region: "eu",
          },
          lineCount: 12,
        }}
        contextMdUpdating={false}
      />,
    );

    await user.click(screen.getByTestId("project-memory-row"));
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
  });
});
