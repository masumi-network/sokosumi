import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoworkerOption } from "@/lib/types/coworker";

const { useReducedMotionMock, confettiBurstMock } = vi.hoisted(() => ({
  useReducedMotionMock: vi.fn(() => false),
  confettiBurstMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onNavigate,
  }: {
    children: ReactNode;
    href: string;
    onNavigate?: (event: { preventDefault: () => void }) => void;
  }) => (
    <a
      href={href}
      onClick={() => {
        onNavigate?.({ preventDefault() {} });
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return {
    ...actual,
    useReducedMotion: () => useReducedMotionMock(),
  };
});

vi.mock("@/components/ui/confetti-burst", () => ({
  ConfettiBurst: (props: unknown) => {
    confettiBurstMock(props);
    return null;
  },
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
  beforeEach(() => {
    useReducedMotionMock.mockReturnValue(false);
    confettiBurstMock.mockClear();
  });

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

  it("renders the confetti burst when motion is not reduced", async () => {
    useReducedMotionMock.mockReturnValue(false);

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

    expect(confettiBurstMock).toHaveBeenCalled();
  });

  it("skips the confetti burst when the user prefers reduced motion", async () => {
    useReducedMotionMock.mockReturnValue(true);

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

    expect(confettiBurstMock).not.toHaveBeenCalled();
  });

  it("closes the modal (clearing the caller's success marker) when a coworker link is clicked", async () => {
    const onOpenChange = vi.fn();
    const coworkers = [
      createCoworker({ id: "1", slug: "elena", name: "Elena" }),
    ];

    await act(async () => {
      render(
        <PurchaseSuccessModal
          open
          onOpenChange={onOpenChange}
          headline="Headline text"
          description="Description text"
          coworkersPromise={Promise.resolve(coworkers)}
        />,
      );
    });

    screen.getByText("Elena").closest("a")?.click();

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
