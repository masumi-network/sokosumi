import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Coworker } from "@/lib/clients/generated/core";

const openCoworkerRoomMock = vi.fn();
const handleOpenWithMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const maps: Record<
      string,
      (key: string, values?: Record<string, string>) => string
    > = {
      "App.Agents.CoworkerGallerySection": (key, values) => {
        if (key === "startForCoworker") {
          return `Start New Task for ${values?.name ?? ""}`;
        }
        if (key === "coworkerCount") {
          return "1 coworker";
        }
        if (key === "outputTypes.document") return "Document";
        if (key === "outputTypes.pdf") return "PDF";
        if (key === "outputTypes.image") return "Image";
        if (key === "outputTypes.other") return "Other";
        return key;
      },
      "App.Chat.Landing": (key, values) => {
        if (key === "cta.button") {
          return `Chat with ${values?.name ?? ""}`;
        }
        if (key === "cta.opening") return "Opening chat…";
        if (key === "cta.error") return "Could not open the chat.";
        return key;
      },
    };
    return maps[namespace] ?? ((key: string) => key);
  },
}));

vi.mock("next/image", () => ({
  default: function MockImage({ alt }: { alt: string }) {
    return <div data-testid="gallery-image" aria-label={alt} />;
  },
}));

vi.mock("@/hooks/use-gallery-filter", () => ({
  default: () => ({ query: "", setQuery: vi.fn() }),
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  useCreateTaskModal: () => ({ handleOpenWith: handleOpenWithMock }),
}));

vi.mock("@/app/chat/components/landing/use-open-coworker-room", () => ({
  OpenCoworkerRoomProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useOpenCoworkerRoom: () => ({
    isPending: false,
    openCoworkerRoom: openCoworkerRoomMock,
    openingId: null,
  }),
}));

import { CoworkerGallerySection } from "../coworker-gallery-section";

function makeCoworker(overrides: Partial<Coworker> = {}): Coworker {
  return {
    id: "cow-elena",
    slug: "elena",
    name: "Elena",
    caption: "Strategy",
    description: "Strategy partner",
    image: null,
    priority: 10,
    archivedAt: null,
    isWhitelisted: true,
    baseURL: "https://responses.example.com/v1",
    capabilities: ["tasks", "chat"],
    metadata: null,
    vendor: {
      id: "vendor-sp",
      name: "Serviceplan",
      slug: "serviceplan",
      logos: { light: null, dark: null },
    },
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  } as Coworker;
}

describe("CoworkerGallerySection chat CTA", () => {
  beforeEach(() => {
    openCoworkerRoomMock.mockReset();
    handleOpenWithMock.mockReset();
  });

  it("shows Chat with {name} next to Start New Task when coworker can chat", () => {
    render(<CoworkerGallerySection coworkers={[makeCoworker()]} />);

    expect(
      screen.getByRole("button", { name: "Chat with Elena" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start New Task for Elena/ }),
    ).toBeInTheDocument();
  });

  it("hides chat CTA when coworker is not chat-capable", () => {
    render(
      <CoworkerGallerySection
        coworkers={[
          makeCoworker({
            id: "cow-tasks-only",
            name: "Tasks Only",
            slug: "tasks-only",
            capabilities: ["tasks"],
            baseURL: null,
          }),
        ]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Chat with/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start New Task for Tasks Only/ }),
    ).toBeInTheDocument();
  });

  it("opens the coworker direct room when chat CTA is clicked", async () => {
    const user = userEvent.setup();
    render(<CoworkerGallerySection coworkers={[makeCoworker()]} />);

    await user.click(screen.getByRole("button", { name: "Chat with Elena" }));

    expect(openCoworkerRoomMock).toHaveBeenCalledWith("cow-elena");
  });
});
