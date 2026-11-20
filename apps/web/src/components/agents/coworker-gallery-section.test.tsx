import { render, screen } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { CoworkerGallerySection } from "./coworker-gallery-section";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${key}:${values.count}`,
  useFormatter: () => ({ number: (value: number) => `n${value}` }),
}));

vi.mock("next/image", () => import("@/test/next-image"));

vi.mock("@/app/chat/components/landing/start-chat-button.client", () => ({
  StartChatButton: () => null,
}));

vi.mock("@/app/chat/components/landing/use-open-coworker-room", () => ({
  OpenCoworkerRoomProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  useCreateTaskModal: () => ({ handleOpenWith: vi.fn() }),
}));

function renderAt(searchParams: string) {
  return render(<CoworkerGallerySection coworkers={[]} />, {
    wrapper: withNuqsTestingAdapter({ searchParams }),
  });
}

describe("CoworkerGallerySection with no coworkers", () => {
  it("keeps the page's one search and the Show control", () => {
    renderAt("");

    expect(
      screen.getByRole("textbox", { name: "searchHint" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "label" }),
    ).toBeInTheDocument();
  });

  it("says so, and announces it, when Coworkers is shown", () => {
    renderAt("?show=coworkers");

    expect(screen.getByText("noCoworkers")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "all" })).toBeInTheDocument();
  });

  it("announces how many coworkers match a search", () => {
    renderAt("?query=research");

    expect(screen.getByRole("status")).toHaveTextContent("coworkersFound:0");
  });
});
