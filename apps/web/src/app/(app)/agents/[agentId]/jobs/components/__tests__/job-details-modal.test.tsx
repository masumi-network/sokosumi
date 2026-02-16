import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { JobDetailsModal } from "@/app/agents/[agentId]/jobs/components/job-details-modal";

const replaceMock = jest.fn();

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () =>
    ({
      toString: () => "",
    }) as URLSearchParams,
}));

jest.mock("@/components/jobs", () => ({
  JobDetails: () => <div data-testid="job-details">Job Details</div>,
}));

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

describe("JobDetailsModal", () => {
  beforeEach(() => {
    replaceMock.mockClear();
  });

  it("renders modal content on viewports below lg", async () => {
    mockMatchMedia(true);

    render(
      <JobDetailsModal
        activeOrganizationId={null}
        agentId="agent-1"
        job={{} as never}
        readOnly={false}
      />,
    );

    expect(await screen.findByTestId("job-details")).toBeInTheDocument();
  });

  it("does not render modal content on lg and above", () => {
    mockMatchMedia(false);

    render(
      <JobDetailsModal
        activeOrganizationId={null}
        agentId="agent-1"
        job={{} as never}
        readOnly={false}
      />,
    );

    expect(screen.queryByTestId("job-details")).not.toBeInTheDocument();
  });
});
