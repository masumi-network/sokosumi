import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CoworkerOption } from "@/lib/types/coworker";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

import { PurchaseSuccessCoworkerRow } from "../purchase-success-coworker-row";

function createCoworker(
  overrides: Partial<CoworkerOption> = {},
): CoworkerOption {
  return {
    id: "coworker-1",
    slug: "elena",
    name: "Elena",
    image: "https://example.com/elena.png",
    vendor: {
      id: "vendor-1",
      name: "Vendor",
      slug: "vendor",
      logos: { light: null, dark: null },
    },
    ...overrides,
  };
}

describe("PurchaseSuccessCoworkerRow", () => {
  it("shows a loading skeleton while the coworkers promise is pending", () => {
    const coworkersPromise = new Promise<CoworkerOption[]>(() => {});

    const { container } = render(
      <PurchaseSuccessCoworkerRow coworkersPromise={coworkersPromise} />,
    );

    expect(container.querySelectorAll("[aria-hidden]").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("Elena")).not.toBeInTheDocument();
  });

  it("renders each coworker as a link into the task form with them pre-selected", async () => {
    const coworkers = [
      createCoworker({ id: "1", slug: "elena", name: "Elena" }),
      createCoworker({ id: "2", slug: "hannah", name: "Hannah" }),
      createCoworker({ id: "3", slug: "alex", name: "Alex" }),
    ];

    await act(async () => {
      render(
        <PurchaseSuccessCoworkerRow
          coworkersPromise={Promise.resolve(coworkers)}
        />,
      );
    });

    expect(screen.getByText("Elena").closest("a")).toHaveAttribute(
      "href",
      "/tasks?create=true&assignee=elena",
    );
    expect(screen.getByText("Hannah").closest("a")).toHaveAttribute(
      "href",
      "/tasks?create=true&assignee=hannah",
    );
    expect(screen.getByText("Alex").closest("a")).toHaveAttribute(
      "href",
      "/tasks?create=true&assignee=alex",
    );
  });

  it("encodes slugs used in the coworker link", async () => {
    const coworkers = [createCoworker({ id: "1", slug: "a b", name: "A B" })];

    await act(async () => {
      render(
        <PurchaseSuccessCoworkerRow
          coworkersPromise={Promise.resolve(coworkers)}
        />,
      );
    });

    expect(screen.getByText("A B").closest("a")).toHaveAttribute(
      "href",
      "/tasks?create=true&assignee=a%20b",
    );
  });

  it("falls back to a 'go to tasks' link when no coworkers resolve", async () => {
    await act(async () => {
      render(
        <PurchaseSuccessCoworkerRow coworkersPromise={Promise.resolve([])} />,
      );
    });

    expect(screen.getByText("goToTasks").closest("a")).toHaveAttribute(
      "href",
      "/tasks",
    );
  });
});
