import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";

import { FileChipWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: {
    src: string;
    alt: string;
    fill?: boolean;
    sizes?: string;
    className?: string;
  }) => {
    return <img src={props.src} alt={props.alt} className={props.className} />;
  },
}));

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function createHeaders(values: Record<string, string | null>) {
  return {
    get: (key: string) => values[key.toLowerCase()] ?? null,
  };
}

describe("FileChipWithMetadata", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("loads filename and size from HEAD metadata", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: createHeaders({
        "content-disposition": 'attachment; filename="from-head.pdf"',
        "content-length": "2048",
        "content-type": "application/pdf",
      }),
    });

    render(<FileChipWithMetadata url="https://files.example/input.pdf" />);

    // Fallback-first rendering
    expect(screen.getByText("input.pdf")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("from-head.pdf")).toBeInTheDocument();
      expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith("https://files.example/input.pdf", {
      method: "HEAD",
      signal: expect.any(AbortSignal),
    });
  });

  it("falls back to URL filename when HEAD fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    render(<FileChipWithMetadata url="https://files.example/fallback.txt" />);

    await waitFor(() => {
      expect(screen.getByText("fallback.txt")).toBeInTheDocument();
    });
    expect(screen.queryByText(/KB|MB|GB|B/)).not.toBeInTheDocument();
  });

  it("handles mixed metadata success and failure across multiple URLs", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: createHeaders({
          "content-disposition": 'attachment; filename="first-head.pdf"',
          "content-length": "1024",
          "content-type": "application/pdf",
        }),
      })
      .mockRejectedValueOnce(new Error("cors"));

    render(
      <div>
        <FileChipWithMetadata url="https://files.example/first.pdf" />
        <FileChipWithMetadata url="https://files.example/second.pdf" />
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByText("first-head.pdf")).toBeInTheDocument();
      expect(screen.getByText("1.0 KB")).toBeInTheDocument();
      expect(screen.getByText("second.pdf")).toBeInTheDocument();
    });
  });

  it("clears stale metadata when URL changes and next HEAD response is non-ok", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: createHeaders({
          "content-disposition": 'attachment; filename="first-head.pdf"',
          "content-length": "1024",
          "content-type": "application/pdf",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        headers: createHeaders({
          "content-disposition": null,
          "content-length": null,
          "content-type": null,
        }),
      });

    const { rerender } = render(
      <FileChipWithMetadata url="https://files.example/first.pdf" />,
    );

    await waitFor(() => {
      expect(screen.getByText("first-head.pdf")).toBeInTheDocument();
      expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    });

    rerender(<FileChipWithMetadata url="https://files.example/second.pdf" />);

    await waitFor(() => {
      expect(screen.getByText("second.pdf")).toBeInTheDocument();
    });
    expect(screen.queryByText("first-head.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText("1.0 KB")).not.toBeInTheDocument();
  });

  it("uses raw filename when content-disposition filename cannot be decoded", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: createHeaders({
        "content-disposition": 'attachment; filename="100%_report.pdf"',
        "content-length": "1024",
        "content-type": "application/pdf",
      }),
    });

    render(<FileChipWithMetadata url="https://files.example/input.pdf" />);

    await waitFor(() => {
      expect(screen.getByText("100%_report.pdf")).toBeInTheDocument();
    });
  });

  it("shows zero-byte file size when content-length is zero", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: createHeaders({
        "content-disposition": 'attachment; filename="empty.txt"',
        "content-length": "0",
        "content-type": "text/plain",
      }),
    });

    render(<FileChipWithMetadata url="https://files.example/empty.txt" />);

    await waitFor(() => {
      expect(screen.getByText("empty.txt")).toBeInTheDocument();
      expect(screen.getByText("0 B")).toBeInTheDocument();
    });
  });
});
