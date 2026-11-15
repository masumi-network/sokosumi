import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import type { Team, TeamPerson } from "@/lib/team-file";

import { TeamView } from "./team-view";

function person(id: string, name: string): TeamPerson {
  return {
    id,
    name,
    role: "Founder",
    summary: `${name} builds things.`,
    highlights: ["Built NMKR"],
    experience: [{ title: "CEO", place: "NMKR", when: "2021–" }],
    education: [],
    advisor: false,
  };
}

function team(people: TeamPerson[]): Team {
  return { kind: "sokosumi.team", version: 1, people };
}

describe("TeamView", () => {
  afterEach(cleanup);

  it("shows one person as a profile page", () => {
    render(<TeamView team={team([person("ada", "Ada Lovelace")])} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Ada Lovelace" }),
    ).toBeDefined();
    expect(screen.getByText("Ada Lovelace builds things.")).toBeDefined();
    expect(screen.getByText("CEO")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows several people as an org chart that opens each profile", () => {
    render(
      <TeamView
        team={team([
          person("ada", "Ada Lovelace"),
          person("alan", "Alan Turing"),
        ])}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: /Ada Lovelace/ }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Ada Lovelace builds things.")).toBeNull();
  });
});
