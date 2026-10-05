import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { ProjectMemoryPanel } from "@/app/projects/components/project-memory-panel";

const MESSAGES = {
  App: {
    Projects: {
      Detail: {
        errors: { contextMd: "Memory could not be loaded." },
        memory: {
          fileName: "Memory",
          updated: "Updated {when}",
          updating: "Updating…",
          empty: "Builds as tasks complete",
          emptyBody: "Memory is written the first time a task completes.",
          modelLine: "{model} · hosted in the EU",
          defaultModel: "Mistral Medium",
          offHint: "Completed tasks will not add to memory.",
          off: "Memory is off",
          copyLink: "Copy link",
          openRaw: "Open raw",
          copied: "Copied",
          history: {
            title: "History ({count})",
            version: "Version {version}",
            onlyCurrentRetained: "Only the current version is kept.",
            contentUnavailable: "This version's content is no longer stored.",
          },
        },
      },
    },
  },
};

const MODEL = {
  id: "mistral/mistral-medium-latest",
  label: "Mistral Medium",
  region: "eu" as const,
};

const CONTEXT_MD = {
  url: "https://blob.example/projects/project-1/CONTEXT.md",
  updatedAt: new Date("2026-09-20T10:00:00.000Z"),
  version: 47,
  model: MODEL,
  lineCount: 42,
};

function renderPanel(
  props: Partial<React.ComponentProps<typeof ProjectMemoryPanel>> = {},
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="UTC"
      now={new Date("2026-09-27T10:00:00.000Z")}
    >
      <ProjectMemoryPanel
        content={"# Project Context\n\n## Active goals\n- Ship the studio."}
        contextMd={CONTEXT_MD}
        contextMdUpdating={false}
        memoryEnabled
        memoryModel={MODEL}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("ProjectMemoryPanel", () => {
  it("puts the document on the page rather than behind a dialog", () => {
    renderPanel();

    // A tab is already the "show me this" gesture; a dialog on top of it would
    // be one more click to the same words.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/Ship the studio/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Memory" })).toBeInTheDocument();
    expect(
      screen.getByText("Mistral Medium · hosted in the EU"),
    ).toBeInTheDocument();
  });

  it("offers the raw file and its link where there is one", () => {
    renderPanel();

    expect(screen.getByRole("link", { name: "Open raw" })).toHaveAttribute(
      "href",
      CONTEXT_MD.url,
    );
    expect(
      screen.getByRole("button", { name: "Copy link" }),
    ).toBeInTheDocument();
  });

  it("starts the history collapsed, at the one version that is retained", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "History (1)" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("explains an empty memory instead of showing an empty page", () => {
    renderPanel({ content: null, contextMd: null });

    expect(screen.getByText("Builds as tasks complete")).toBeInTheDocument();
    expect(
      screen.getByText("Memory is written the first time a task completes."),
    ).toBeInTheDocument();
    // Nothing to link to, and no history to disclose: a project that has never
    // had a memory has no versions, not zero of them.
    expect(screen.queryByRole("link", { name: "Open raw" })).toBeNull();
    expect(screen.queryByRole("button", { name: /History/ })).toBeNull();
  });

  it("says a refresh is running without hiding what is already there", () => {
    renderPanel({ contextMdUpdating: true });

    expect(screen.getByTestId("project-memory-updating")).toBeInTheDocument();
    expect(screen.getByText(/Ship the studio/)).toBeInTheDocument();
  });

  it("keeps existing memory readable when updates are switched off", () => {
    renderPanel({ memoryEnabled: false });

    // The hint explains why it will not grow, not why it is hidden.
    expect(screen.getByTestId("project-memory-disabled")).toBeInTheDocument();
    expect(screen.getByText(/Ship the studio/)).toBeInTheDocument();
  });

  it("does not promise memory that updates are switched off for", () => {
    renderPanel({ contextMd: null, content: null, memoryEnabled: false });

    expect(screen.getByText("Memory is off")).toBeInTheDocument();
    expect(
      screen.getByText("Completed tasks will not add to memory."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Builds as tasks complete")).toBeNull();
    expect(screen.queryByText(/hosted in the EU/)).toBeNull();
    expect(
      screen.queryByText("Memory is written the first time a task completes."),
    ).toBeNull();
  });

  it("names the model the document was written with when the project has none", () => {
    renderPanel({ memoryModel: null });

    expect(
      screen.getByText("Mistral Medium · hosted in the EU"),
    ).toBeInTheDocument();
  });

  it("falls back to the default model when nothing names one", () => {
    renderPanel({ contextMd: null, content: null, memoryModel: null });

    expect(
      screen.getByText("Mistral Medium · hosted in the EU"),
    ).toBeInTheDocument();
  });

  it("distinguishes a document that failed to load from one that is empty", () => {
    renderPanel({ content: null });

    expect(screen.getByText("Memory could not be loaded.")).toBeInTheDocument();
  });
});
