import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CoworkerOption } from "@/lib/types/coworker";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { PurchaseSuccessModal } from "../purchase-success-modal";

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

describe("PurchaseSuccessModal", () => {
  it("does not render its content when closed", () => {
    render(
      <PurchaseSuccessModal
        open={false}
        onOpenChange={() => {}}
        headline="Headline text"
        description="Description text"
        coworkersPromise={Promise.resolve([])}
      />,
    );

    expect(screen.queryByText("Headline text")).not.toBeInTheDocument();
  });

  it("renders the headline and description when open", async () => {
    await act(async () => {
      render(
        <PurchaseSuccessModal
          open
          onOpenChange={() => {}}
          headline="Headline text"
          description="Description text"
          coworkersPromise={Promise.resolve([])}
        />,
      );
    });

    expect(screen.getByText("Headline text")).toBeInTheDocument();
    expect(screen.getByText("Description text")).toBeInTheDocument();
    expect(screen.getByText("coworkerRowTitle")).toBeInTheDocument();
    expect(screen.getByText("coworkerRowDescription")).toBeInTheDocument();
  });

  it("renders the resolved coworkers via the coworker row", async () => {
    const coworkers = [
      createCoworker({ id: "1", slug: "elena", name: "Elena" }),
      createCoworker({ id: "2", slug: "hannah", name: "Hannah" }),
    ];

    await act(async () => {
      render(
        <PurchaseSuccessModal
          open
          onOpenChange={() => {}}
          headline="Headline text"
          description="Description text"
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
  });

  it("falls back to a 'go to tasks' link when no coworkers resolve", async () => {
    await act(async () => {
      render(
        <PurchaseSuccessModal
          open
          onOpenChange={() => {}}
          headline="Headline text"
          description="Description text"
          coworkersPromise={Promise.resolve([])}
        />,
      );
    });

    expect(screen.getByText("goToTasks").closest("a")).toHaveAttribute(
      "href",
      "/tasks",
    );
  });

  it("calls onOpenChange when dismissed", async () => {
    const onOpenChange = vi.fn();

    await act(async () => {
      render(
        <PurchaseSuccessModal
          open
          onOpenChange={onOpenChange}
          headline="Headline text"
          description="Description text"
          coworkersPromise={Promise.resolve([])}
        />,
      );
    });

    const closeButton = screen.getByRole("button", { name: /close/i });

    await act(async () => {
      closeButton.click();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
