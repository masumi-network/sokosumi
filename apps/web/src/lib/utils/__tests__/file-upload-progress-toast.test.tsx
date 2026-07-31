import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastCustomMock, toastDismissMock } = vi.hoisted(() => ({
  toastCustomMock: vi.fn(),
  toastDismissMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    custom: (...args: unknown[]) => toastCustomMock(...args),
    dismiss: (...args: unknown[]) => toastDismissMock(...args),
  },
}));

import { createFileUploadProgressToast } from "@/lib/utils/file-upload-progress-toast";

interface ToastElementProps {
  items: Array<{
    id: string;
    loaded: number;
    percentage: number;
    total: number;
  }>;
}

function getLatestToastElement(): ReactElement<ToastElementProps> {
  const renderToast = toastCustomMock.mock.lastCall?.[0] as
    | ((id: string | number) => ReactElement<ToastElementProps>)
    | undefined;

  expect(renderToast).toBeDefined();

  return renderToast?.("toast-id") as ReactElement<ToastElementProps>;
}

describe("file-upload-progress-toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates multi-file rows with new item references for each progress event", () => {
    const firstFile = new File(["abcd"], "first.pdf", {
      type: "application/pdf",
    });
    const secondFile = new File(["efgh"], "second.pdf", {
      type: "application/pdf",
    });
    const uploadToast = createFileUploadProgressToast({
      files: [firstFile, secondFile],
      labels: {
        uploadingFile: "Uploading {fileName}",
        uploadingFiles: "Uploading {count} files",
      },
    });

    const initialElement = getLatestToastElement();
    const initialItems = initialElement.props.items;

    uploadToast.updateFileProgress(0, {
      loaded: 2,
      total: 4,
      percentage: 50,
    });

    const firstUpdateElement = getLatestToastElement();
    const firstUpdateItems = firstUpdateElement.props.items;

    expect(firstUpdateItems).not.toBe(initialItems);
    expect(firstUpdateItems[0]).not.toBe(initialItems[0]);
    expect(firstUpdateItems[1]).toBe(initialItems[1]);
    expect(firstUpdateItems[0]).toMatchObject({
      loaded: 2,
      total: 4,
      percentage: 50,
    });

    const firstRender = render(firstUpdateElement);
    expect(screen.getByText("Uploading 2 files")).toBeInTheDocument();
    expect(screen.getByText("2 B / 8 B")).toBeInTheDocument();
    expect(screen.getByText("2 B / 4 B")).toBeInTheDocument();
    expect(screen.getByText("0 B / 4 B")).toBeInTheDocument();
    firstRender.unmount();

    uploadToast.updateFileProgress(1, {
      loaded: 1,
      total: 4,
      percentage: 25,
    });

    const secondUpdateElement = getLatestToastElement();
    const secondUpdateItems = secondUpdateElement.props.items;

    expect(secondUpdateItems).not.toBe(firstUpdateItems);
    expect(secondUpdateItems[0]).toBe(firstUpdateItems[0]);
    expect(secondUpdateItems[1]).not.toBe(firstUpdateItems[1]);
    expect(secondUpdateItems[1]).toMatchObject({
      loaded: 1,
      total: 4,
      percentage: 25,
    });

    render(secondUpdateElement);
    expect(screen.getByText("3 B / 8 B")).toBeInTheDocument();
    expect(screen.getByText("1 B / 4 B")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("keeps the toast shell from blocking parent scrolling", () => {
    const uploadToast = createFileUploadProgressToast({
      files: [new File(["abcd"], "first.pdf", { type: "application/pdf" })],
      labels: {
        uploadingFile: "Uploading {fileName}",
        uploadingFiles: "Uploading {count} files",
      },
    });

    const toastElement = getLatestToastElement();
    const { container } = render(toastElement);
    const toastOptions = toastCustomMock.mock.lastCall?.[1] as
      | {
          classNames?: {
            toast?: string;
            content?: string;
            title?: string;
          };
        }
      | undefined;

    expect(container.firstChild).toHaveClass("pointer-events-none");
    expect(container.querySelector(".overflow-y-auto")).toHaveClass(
      "pointer-events-auto",
      "overscroll-contain",
      "touch-pan-y",
    );
    expect(toastOptions?.classNames).toEqual({
      toast: "!pointer-events-none !touch-auto",
      content: "pointer-events-none",
      title: "pointer-events-none",
    });

    uploadToast.dismiss();
  });
});
