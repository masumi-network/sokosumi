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
  });

  it("offers a retry when Core refuses or fails", async () => {
    getOrganizationCreditSpendMock.mockRejectedValue(new Error("403"));

    await renderCard();

    expect(screen.getByText("loadError")).toBeInTheDocument();
  });
});
