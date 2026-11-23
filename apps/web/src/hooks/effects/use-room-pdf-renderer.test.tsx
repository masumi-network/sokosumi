import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoomPdfRenderer } from "@/hooks/effects/use-room-pdf-renderer";

const getDocumentMock = vi.fn();
const globalWorkerOptions = { workerSrc: "" };

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: globalWorkerOptions,
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}));

const translate = (key: "pdfPage", values: { number: number }) =>
  `${key}:${values.number}`;

function Harness({
  url,
  t = translate,
}: {
  url: string;
  t?: (key: "pdfPage", values: { number: number }) => string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const state = useRoomPdfRenderer({ container, url, t });
  return (
    <div>
      <span data-testid="state">{state}</span>
      <div ref={container} data-testid="host" />
    </div>
  );
}

function makePdfDocument(pageCount: number) {
  const renderCalls: Array<{
    canvas: HTMLCanvasElement;
    viewport: { width: number; height: number };
  }> = [];
  return {
    renderCalls,
    doc: {
      numPages: pageCount,
      getPage: vi.fn(async (_pageNumber: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 400 * scale,
          height: 600 * scale,
        }),
        render: (params: {
          canvas: HTMLCanvasElement;
          viewport: { width: number; height: number };
        }) => {
          renderCalls.push(params);
          return { promise: Promise.resolve() };
        },
      })),
    },
  };
}

describe("useRoomPdfRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalWorkerOptions.workerSrc = "";
  });

  afterEach(() => {
    cleanup();
  });

  it("renders each PDF page into a canvas inside the passed container ref", async () => {
    const { doc, renderCalls } = makePdfDocument(2);
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) });

    render(<Harness url="/share/rooms/tok/files/doc-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("ready");
    });

    const canvases = screen.getByTestId("host").querySelectorAll("canvas");
    expect(canvases).toHaveLength(2);
    expect(canvases[0]?.getAttribute("aria-label")).toBe("pdfPage:1");
    expect(canvases[1]?.getAttribute("aria-label")).toBe("pdfPage:2");
    expect(renderCalls).toHaveLength(2);
    expect(getDocumentMock).toHaveBeenCalledWith({
      url: "/share/rooms/tok/files/doc-1",
      withCredentials: true,
    });
    expect(globalWorkerOptions.workerSrc).toContain("pdf.worker.min.mjs");
  });

  it("transitions to failed when loading the PDF rejects", async () => {
    getDocumentMock.mockReturnValue({
      promise: Promise.reject(new Error("corrupt pdf")),
    });

    render(<Harness url="/share/rooms/tok/files/broken" />);

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("failed");
    });
  });

  it("replaces canvases on url change and ignores cancelled loads", async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = makePdfDocument(1);
    const second = makePdfDocument(1);

    getDocumentMock
      .mockReturnValueOnce({
        promise: new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      })
      .mockReturnValueOnce({ promise: Promise.resolve(second.doc) });

    const { rerender, unmount } = render(
      <Harness url="/share/rooms/tok/files/doc-1" />,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("loading");

    rerender(<Harness url="/share/rooms/tok/files/doc-2" />);

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("ready");
    });

    resolveFirst(first.doc);
    await Promise.resolve();

    expect(screen.getByTestId("host").querySelectorAll("canvas")).toHaveLength(
      1,
    );
    expect(first.renderCalls).toHaveLength(0);
    expect(second.renderCalls).toHaveLength(1);

    unmount();
  });
});
