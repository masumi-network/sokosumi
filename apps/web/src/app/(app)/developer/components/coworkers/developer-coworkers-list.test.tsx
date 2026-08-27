import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const t = (key: string) => {
      const values: Record<string, string> = {
        "List.empty": "You do not own any active coworkers yet.",
        "List.noCaption": "No caption",
        "List.edit": "Edit",
      };
      return values[key] ?? key;
    };
    return t;
  },
}));

import { mockCoreCoworker } from "@/test-fixtures/coworker";
import { DeveloperCoworkersList } from "./developer-coworkers-list";

const coworker = mockCoreCoworker({
  caption: null,
});

describe("DeveloperCoworkersList", () => {
  it("renders empty state", async () => {
    render(await DeveloperCoworkersList({ coworkers: [] }));

    expect(
      screen.getByText("You do not own any active coworkers yet."),
    ).toBeInTheDocument();
  });

  it("renders coworker row with edit link", async () => {
    render(await DeveloperCoworkersList({ coworkers: [coworker] }));

    expect(screen.getByText("Ops Agent")).toBeInTheDocument();
    expect(screen.getByText("No caption")).toBeInTheDocument();
    expect(screen.getByText("ops-agent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/developer/coworkers/cow_1",
    );
  });
});
