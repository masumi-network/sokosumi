import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import JobDetailsInputs from "@/components/jobs/job-details/inputs";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => {
    return <div data-testid="markdown-mock">{children}</div>;
  },
}));

vi.mock("next/image", () => ({
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

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  global.ResizeObserver =
    ResizeObserverMock as unknown as typeof global.ResizeObserver;
});

describe("JobDetailsInputs", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("head unavailable"));
  });

  it("renders input content without attachment relation data", async () => {
    const input = JSON.stringify({
      document: "https://files.example/report.pdf",
    });
    const inputSchema = JSON.stringify({
      input_data: [
        {
          id: "document",
          type: "file",
          name: "Document",
          data: {
            outputFormat: "url",
          },
          validations: [],
        },
      ],
    });

    render(<JobDetailsInputs input={input} inputSchema={inputSchema} />);

    expect(screen.getByText("Document")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });
  });

  it("renders markdown for text, textarea, and none input values", () => {
    const input = JSON.stringify({
      title: "**Bold title**",
      notes: "A paragraph with a [link](https://example.com)",
      readonlyInfo: "Readonly with `inline code`",
    });

    const inputSchema = JSON.stringify({
      input_data: [
        {
          id: "title",
          type: "text",
          name: "Title",
          data: {},
          validations: [],
        },
        {
          id: "notes",
          type: "textarea",
          name: "Notes",
          data: {},
          validations: [],
        },
        {
          id: "readonlyInfo",
          type: "none",
          name: "Readonly Info",
          data: {
            description: "Readonly description",
          },
        },
      ],
    });

    render(<JobDetailsInputs input={input} inputSchema={inputSchema} />);

    const markdownValues = screen.getAllByTestId("markdown-mock");

    expect(markdownValues).toHaveLength(3);
    expect(markdownValues[0]).toHaveTextContent("**Bold title**");
    expect(markdownValues[1]).toHaveTextContent(
      "A paragraph with a [link](https://example.com)",
    );
    expect(markdownValues[2]).toHaveTextContent("Readonly with `inline code`");
  });

  it("renders schema defaults for missing text and textarea values", () => {
    const input = JSON.stringify({});

    const inputSchema = JSON.stringify({
      input_data: [
        {
          id: "language",
          type: "text",
          name: "Campaign Language",
          data: {
            default: "English",
          },
          validations: [],
        },
        {
          id: "goal",
          type: "textarea",
          name: "Primary Campaign Goal",
          data: {
            default: "Generate leads and increase brand awareness",
          },
          validations: [],
        },
      ],
    });

    render(<JobDetailsInputs input={input} inputSchema={inputSchema} />);

    expect(screen.getByText("Campaign Language")).toBeInTheDocument();
    expect(screen.getByText("Primary Campaign Goal")).toBeInTheDocument();

    const markdownValues = screen.getAllByTestId("markdown-mock");
    expect(markdownValues[0]).toHaveTextContent("English");
    expect(markdownValues[1]).toHaveTextContent(
      "Generate leads and increase brand awareness",
    );
  });

  it("does not reparse raw input on unrelated rerenders", () => {
    const input = JSON.stringify({
      title: "Persisted title",
    });
    const inputSchema = JSON.stringify({
      input_data: [
        {
          id: "title",
          type: "text",
          name: "Title",
          data: {},
          validations: [],
        },
      ],
    });
    const originalParse = JSON.parse;
    const parseSpy = vi
      .spyOn(JSON, "parse")
      .mockImplementation(((text, reviver) =>
        originalParse(text, reviver)) as typeof JSON.parse);

    try {
      const { rerender } = render(
        <JobDetailsInputs input={input} inputSchema={inputSchema} />,
      );

      expect(
        parseSpy.mock.calls.filter(([value]) => value === input),
      ).toHaveLength(1);

      rerender(
        <JobDetailsInputs
          input={input}
          inputSchema={inputSchema}
          inputHash="updated-hash"
        />,
      );

      expect(
        parseSpy.mock.calls.filter(([value]) => value === input),
      ).toHaveLength(1);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("renders boolean values with humanized labels", () => {
    const input = JSON.stringify({
      acceptedTerms: true,
      isPublic: false,
    });

    const inputSchema = JSON.stringify({
      input_data: [
        {
          id: "acceptedTerms",
          type: "boolean",
          name: "Accepted Terms",
          data: {},
          validations: [],
        },
        {
          id: "isPublic",
          type: "boolean",
          name: "Public Job",
          data: {},
          validations: [],
        },
      ],
    });

    render(<JobDetailsInputs input={input} inputSchema={inputSchema} />);

    expect(screen.getByText("Accepted Terms")).toBeInTheDocument();
    expect(screen.getByText("Public Job")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getByText("no")).toBeInTheDocument();
  });
});
