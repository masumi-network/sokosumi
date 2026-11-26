import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectBriefingField } from "@/app/projects/components/project-briefing-field";

const toast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast }));

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
      if (key === "copy.copied") return `Copied from ${values?.name}`;
      return key;
    };
  },
}));

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

  it("copies another project's briefing into the field, with undo", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    render(
      <ProjectBriefingField
        value="Old draft"
        onChange={handleChange}
        copySources={[{ id: "a", name: "Alpha", briefing: "Alpha brief" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "copy.trigger" }));
    await user.click(await screen.findByRole("menuitem", { name: "Alpha" }));

    expect(handleChange).toHaveBeenLastCalledWith("Alpha brief");
    const [message, options] = toast.mock.lastCall ?? [];
    expect(message).toBe("Copied from Alpha");
    options.action.onClick();
    expect(handleChange).toHaveBeenLastCalledWith("Old draft");
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
