import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import {
  ProjectMemoryHistory,
  type ProjectMemoryVersion,
} from "@/app/projects/components/project-memory-history";

const MESSAGES = {
  App: {
    Projects: {
      Detail: {
        memory: {
          modelLine: "{model} · hosted in the EU",
          history: {
            title: "History ({count})",
            version: "Version {version}",
            onlyCurrentRetained:
              "Only the current version is kept. Earlier versions of this file are not retained anywhere, so they cannot be shown.",
            contentUnavailable: "This version's content is no longer stored.",
          },
        },
      },
    },
  },
};

const CURRENT: ProjectMemoryVersion = {
  version: 47,
  updatedAt: new Date("2026-09-20T10:00:00.000Z"),
  modelLabel: "Mistral Medium",
  content: "# Project Context\n\n## Active goals\n- Ship the studio.",
};

function renderHistory(versions: ProjectMemoryVersion[] = [CURRENT]) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="UTC"
      now={new Date("2026-09-27T10:00:00.000Z")}
    >
      <ProjectMemoryHistory versions={versions} />
    </NextIntlClientProvider>,
  );
}

describe("ProjectMemoryHistory", () => {
  it("is collapsed until it is asked for", () => {
    renderHistory();

    const disclosure = screen.getByRole("button", { name: "History (1)" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Version 47")).not.toBeInTheDocument();
  });

  it("opens to the versions it has, each one still collapsed", () => {
    renderHistory();

    fireEvent.click(screen.getByRole("button", { name: "History (1)" }));

    expect(screen.getByRole("button", { name: "History (1)" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const entry = screen.getByRole("button", { name: /Version 47/ });
    expect(entry).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Ship the studio/)).not.toBeInTheDocument();
  });

  it("expands one version to that version's own content and model", () => {
    renderHistory();

    fireEvent.click(screen.getByRole("button", { name: "History (1)" }));
    fireEvent.click(screen.getByRole("button", { name: /Version 47/ }));

    expect(screen.getByText(/Ship the studio/)).toBeInTheDocument();
    expect(
      screen.getByText("Mistral Medium · hosted in the EU"),
    ).toBeInTheDocument();
  });

  it("says in the product why the list is one entry long", () => {
    renderHistory();

    fireEvent.click(screen.getByRole("button", { name: "History (1)" }));

    // A history with one entry should explain itself rather than look broken.
    expect(
      screen.getByText(/Earlier versions of this file are not retained/),
    ).toBeInTheDocument();
  });

  it("lists a version whose content is gone without pretending to have it", () => {
    renderHistory([{ ...CURRENT, content: null }]);

    fireEvent.click(screen.getByRole("button", { name: "History (1)" }));
    fireEvent.click(screen.getByRole("button", { name: /Version 47/ }));

    expect(
      screen.getByText("This version's content is no longer stored."),
    ).toBeInTheDocument();
  });

  it("still opens, and still explains itself, with nothing to list", () => {
    renderHistory([]);

    fireEvent.click(screen.getByRole("button", { name: "History (0)" }));

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Earlier versions of this file are not retained/),
    ).toBeInTheDocument();
  });

  it("grows a longer list without changing, for the day one is retained", () => {
    renderHistory([
      CURRENT,
      {
        version: 46,
        updatedAt: new Date("2026-09-19T10:00:00.000Z"),
        modelLabel: "Mistral Medium",
        content: "# Project Context\n\n## Active goals\n- Draw the gallery.",
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "History (2)" }));
    fireEvent.click(screen.getByRole("button", { name: /Version 46/ }));

    expect(screen.getByText(/Draw the gallery/)).toBeInTheDocument();
    // Opening one entry leaves the others closed.
    expect(screen.queryByText(/Ship the studio/)).not.toBeInTheDocument();
  });
});
