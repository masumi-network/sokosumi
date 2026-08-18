import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
});
