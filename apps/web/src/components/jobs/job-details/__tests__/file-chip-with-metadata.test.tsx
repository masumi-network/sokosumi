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
});
