import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProjectBriefingField } from "@/app/projects/components/project-briefing-field";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    return (key: string, values?: Record<string, unknown>) => {
      if (key === "label") return "Briefing";
      if (key === "placeholder") return "Describe the campaign";
      if (key === "guidance") return "Describe the campaign/initiative";
      if (key === "wordCount") return `${values?.count ?? 0} words`;
      if (key === "encouragement") return "Great briefings are 300+ words";
      if (key === "encouragementMet") return "Strong briefing";
      if (key === "chips.goals") return "Goals";
      if (key.startsWith("chips.")) return key.slice("chips.".length);
      if (key === "copy.copied") return `Copied from ${values?.name}.`;
      return key;
    };
  },
}));

function StatefulField({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ProjectBriefingField
      value={value}
      onChange={setValue}
      copySources={[{ id: "a", name: "Alpha", briefing: "Alpha brief" }]}
    />
  );
}

describe("ProjectBriefingField", () => {
  it("inserts a heading chip and updates the word count", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    const { rerender } = render(
      <ProjectBriefingField value="" onChange={handleChange} />,
    );

    expect(screen.getByTestId("briefing-word-count")).toHaveTextContent(
      "0 words",
    );
    await user.click(screen.getByTestId("briefing-chip-goals"));
    expect(handleChange).toHaveBeenCalledWith("## Goals\n");

    rerender(
      <ProjectBriefingField
        value={"## Goals\nWin the quarter"}
        onChange={handleChange}
      />,
    );
    expect(screen.getByTestId("briefing-word-count")).toHaveTextContent(
      "5 words",
    );
  });

  it("replaces the draft with a copied briefing, and Undo by keyboard restores it", async () => {
    const user = userEvent.setup();
    render(<StatefulField initial="Old draft" />);

    await user.click(screen.getByRole("button", { name: "copy.trigger" }));
    await user.click(await screen.findByRole("menuitem", { name: "Alpha" }));

    const field = screen.getByRole("textbox");
    expect(field).toHaveValue("Alpha brief");
    expect(screen.getByRole("status")).toHaveTextContent("Copied from Alpha.");

    // Focus returns to the menu button; Undo is the next stop.
    await user.tab();
    expect(screen.getByRole("button", { name: "copy.undo" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(field).toHaveValue("Old draft");
    expect(field).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: "copy.undo" }),
    ).not.toBeInTheDocument();
  });

  it("drops Undo once the copied text is edited", async () => {
    const user = userEvent.setup();
    render(<StatefulField initial="" />);

    await user.click(screen.getByRole("button", { name: "copy.trigger" }));
    await user.click(await screen.findByRole("menuitem", { name: "Alpha" }));
    await user.type(screen.getByRole("textbox"), " More.");

    expect(screen.getByRole("textbox")).toHaveValue("Alpha brief More.");
    expect(
      screen.queryByRole("button", { name: "copy.undo" }),
    ).not.toBeInTheDocument();
  });

  it("hides the copy menu when no other project has a briefing", () => {
    render(
      <ProjectBriefingField value="" onChange={vi.fn()} copySources={[]} />,
    );
    expect(
      screen.queryByRole("button", { name: "copy.trigger" }),
    ).not.toBeInTheDocument();
  });
});
