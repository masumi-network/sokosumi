import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskShareModal } from "@/app/tasks/components/task-share-modal";

const { MockCoreApiRequestError } = vi.hoisted(() => {
  class MockCoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  }

  return { MockCoreApiRequestError };
});

const routerPushMock = vi.fn();
const routerRefreshMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const putTaskShareMock = vi.fn();
const deleteTaskShareMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    refresh: routerRefreshMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    putTaskShare: (...args: unknown[]) => putTaskShareMock(...args),
    deleteTaskShare: (...args: unknown[]) => deleteTaskShareMock(...args),
  },
}));

describe("TaskShareModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enables public sharing and shows the canonical task link", async () => {
    putTaskShareMock.mockResolvedValue({
      id: "share-1",
      taskId: "task-1",
      token: "public-token",
      allowSearchIndexing: true,
      createdAt: new Date("2026-03-30T10:00:00.000Z"),
      updatedAt: new Date("2026-03-30T10:00:00.000Z"),
    });

    render(
      <TaskShareModal
        open
        onOpenChange={vi.fn()}
        taskId="task-1"
        share={null}
      />,
    );

    fireEvent.click(screen.getByText("publicAccessTitle"));

    await waitFor(() => {
      expect(putTaskShareMock).toHaveBeenCalledWith("task-1", {
        allowSearchIndexing: true,
      });
    });

    expect(routerRefreshMock).toHaveBeenCalled();
    expect(
      await screen.findByRole("link", {
        name: "http://localhost:3000/share/public-token",
      }),
    ).toBeInTheDocument();
  });

  it("updates search indexing for public task shares", async () => {
    putTaskShareMock.mockResolvedValue({
      id: "share-1",
      taskId: "task-1",
      token: "public-token",
      allowSearchIndexing: false,
      createdAt: new Date("2026-03-30T10:00:00.000Z"),
      updatedAt: new Date("2026-03-30T10:00:00.000Z"),
    });

    render(
      <TaskShareModal
        open
        onOpenChange={vi.fn()}
        taskId="task-1"
        share={{
          id: "share-1",
          taskId: "task-1",
          token: "public-token",
          allowSearchIndexing: true,
          createdAt: new Date("2026-03-30T10:00:00.000Z"),
          updatedAt: new Date("2026-03-30T10:00:00.000Z"),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      expect(putTaskShareMock).toHaveBeenCalledWith("task-1", {
        allowSearchIndexing: false,
      });
    });

    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("removes public task sharing", async () => {
    deleteTaskShareMock.mockResolvedValue(undefined);

    render(
      <TaskShareModal
        open
        onOpenChange={vi.fn()}
        taskId="task-1"
        share={{
          id: "share-1",
          taskId: "task-1",
          token: "public-token",
          allowSearchIndexing: true,
          createdAt: new Date("2026-03-30T10:00:00.000Z"),
          updatedAt: new Date("2026-03-30T10:00:00.000Z"),
        }}
      />,
    );

    fireEvent.click(screen.getByText("privateAccessTitle"));

    await waitFor(() => {
      expect(deleteTaskShareMock).toHaveBeenCalledWith("task-1");
    });

    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("routes unauthenticated share errors to the login toast action", async () => {
    putTaskShareMock.mockRejectedValue(
      new MockCoreApiRequestError("Unauthorized", { status: 401 }),
    );

    render(
      <TaskShareModal
        open
        onOpenChange={vi.fn()}
        taskId="task-1"
        share={null}
      />,
    );

    fireEvent.click(screen.getByText("publicAccessTitle"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Errors.unauthenticated", {
        action: {
          label: "Errors.unauthenticatedAction",
          onClick: expect.any(Function),
        },
      });
    });
  });
});
