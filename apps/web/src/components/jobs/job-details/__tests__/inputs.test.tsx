import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";

import JobDetailsInputs from "@/components/jobs/job-details/inputs";

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

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
});
