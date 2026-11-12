import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationCreditSpendCard } from "./organization-credit-spend";

const { getOrganizationCreditSpendMock } = vi.hoisted(() => ({
  getOrganizationCreditSpendMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getFormatter: async () =>
    (await import("@/test/intl-formatter")).createTestFormatter(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: { getOrganizationCreditSpend: getOrganizationCreditSpendMock },
}));

vi.mock("@/components/auth/core-auth-read-retry", () => ({
  CoreAuthReadRetry: ({ description }: { description: string }) => (
    <p>{description}</p>
  ),
}));

const row = {
  image: null,
  isMember: true,
  previousCredits: 0,
};

async function renderCard() {
  render(await OrganizationCreditSpendCard({ organizationId: "org_1" }));
}

describe("OrganizationCreditSpendCard", () => {
  beforeEach(() => {
    getOrganizationCreditSpendMock.mockReset();
  });

  it("lists spend per person with former members and organization charges", async () => {
    getOrganizationCreditSpendMock.mockResolvedValue({
      data: {
        month: "2026-11",
        previousMonth: "2026-10",
        rows: [
          {
            ...row,
            userId: "u1",
            name: "Ada",
            credits: 0.29,
            previousCredits: 4.1,
          },
          {
            ...row,
            userId: "u2",
            name: "Gus",
            isMember: false,
            credits: 12.349,
            previousCredits: 0.29,
          },
          { ...row, userId: null, name: null, isMember: false, credits: 1 },
          { ...row, userId: "u3", name: "Ida", credits: 0 },
        ],
      },
    });

    await renderCard();

    expect(getOrganizationCreditSpendMock).toHaveBeenCalledWith("org_1");
    expect(
      screen.getByRole("columnheader", { name: "November 2026" }),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((tr) => tr.textContent)).toEqual([
      "Ada0.294.1",
      "GusformerMember12.350.29",
      "noPerson10",
      "Ida00",
    ]);
    expect(within(rows[1]).getByText("formerMember")).toBeInTheDocument();
  });

  it("charts this month against last month on one scale, skipping people with no spend", async () => {
    getOrganizationCreditSpendMock.mockResolvedValue({
      data: {
        month: "2026-11",
        previousMonth: "2026-10",
        rows: [
          {
            ...row,
            userId: "u1",
            name: "Ada",
            credits: 50,
            previousCredits: 100,
          },
          {
            ...row,
            userId: "u2",
            name: "Gus",
            credits: 0.2,
            previousCredits: 0,
          },
          { ...row, userId: "u3", name: "Ida", credits: 0 },
        ],
      },
    });

    const { container } = render(
      await OrganizationCreditSpendCard({ organizationId: "org_1" }),
    );

    const chart = container.querySelector("figure");
    expect(chart).toHaveAttribute("aria-hidden", "true");
    expect(chart).toHaveTextContent("November 2026");
    expect(chart).toHaveTextContent("October 2026");
    const bars = [...(chart?.querySelectorAll("li") ?? [])].map((item) => [
      item.querySelector("p")?.textContent,
      ...[...item.querySelectorAll("div")].map((bar) => bar.style.width),
    ]);
    expect(bars).toEqual([
      ["Ada", "50%", "100%"],
      ["Gus", "1%", "0%"],
    ]);
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("keeps the chart to five people plus one bar for everyone else", async () => {
    const people = [
      [100, 50],
      [80, 50],
      [60, 50],
      [40, 50],
      [20, 50],
      [10, 0],
      [5, 0],
      [0, 30],
      [0, 0],
    ].map(([credits, previousCredits], index) => ({
      ...row,
      userId: `u${index}`,
      name: `P${index}`,
      credits,
      previousCredits,
    }));
    getOrganizationCreditSpendMock.mockResolvedValue({
      data: { month: "2026-11", previousMonth: "2026-10", rows: people },
    });

    const { container } = render(
      await OrganizationCreditSpendCard({ organizationId: "org_1" }),
    );

    const bars = [...container.querySelectorAll("figure li")].map((item) => [
      item.querySelector("p")?.textContent,
      ...[...item.querySelectorAll("div")].map((bar) => bar.style.width),
    ]);
    expect(bars).toEqual([
      ["P0", "100%", "50%"],
      ["P1", "80%", "50%"],
      ["P2", "60%", "50%"],
      ["P3", "40%", "50%"],
      ["P4", "20%", "50%"],
      ["otherSpend", "15%", "30%"],
    ]);
    expect(screen.getAllByRole("row")).toHaveLength(people.length + 1);
  });

  it("labels the folded bar neutrally when it holds organization charges", async () => {
    getOrganizationCreditSpendMock.mockResolvedValue({
      data: {
        month: "2026-11",
        previousMonth: "2026-10",
        rows: [
          ...[100, 90, 80, 70, 60, 30].map((credits, index) => ({
            ...row,
            userId: `u${index}`,
            name: `P${index}`,
            credits,
          })),
          { ...row, userId: null, name: null, isMember: false, credits: 20 },
        ],
      },
    });

    const { container } = render(
      await OrganizationCreditSpendCard({ organizationId: "org_1" }),
    );

    const bars = [...container.querySelectorAll("figure li")].map((item) => [
      item.querySelector("p")?.textContent,
      item.querySelector("div")?.style.width,
    ]);
    expect(bars).toHaveLength(6);
    expect(bars[5]).toEqual(["otherSpend", "50%"]);
    expect(screen.getByRole("row", { name: /noPerson/ })).toBeInTheDocument();
  });

  it("charts a sixth person by name instead of folding one person into others", async () => {
    getOrganizationCreditSpendMock.mockResolvedValue({
      data: {
        month: "2026-11",
        previousMonth: "2026-10",
        rows: [60, 50, 40, 30, 20, 10].map((credits, index) => ({
          ...row,
          userId: `u${index}`,
          name: `P${index}`,
          credits,
        })),
      },
    });

    const { container } = render(
      await OrganizationCreditSpendCard({ organizationId: "org_1" }),
    );

    expect(
      [...container.querySelectorAll("figure li p")].map((p) => p.textContent),
    ).toEqual(["P0", "P1", "P2", "P3", "P4", "P5"]);
  });

  it("says so when nothing was spent", async () => {
    getOrganizationCreditSpendMock.mockResolvedValue({
      data: {
        month: "2026-11",
        previousMonth: "2026-10",
        rows: [{ ...row, userId: "u1", name: "Ada", credits: 0 }],
      },
    });

    await renderCard();

    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(document.querySelector("figure")).toBeNull();
  });

  it("offers a retry when Core refuses or fails", async () => {
    getOrganizationCreditSpendMock.mockRejectedValue(new Error("403"));

    await renderCard();

    expect(screen.getByText("loadError")).toBeInTheDocument();
  });
});
