import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPubliclySharedJobMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const JOB_TEST_LABEL_PREFIX = "job:";

vi.mock("next/navigation", () => ({
  notFound: (...args: unknown[]) => notFoundMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    return (
      key: string,
      values?: {
        name?: string;
      },
    ) => {
      if (key === "defaultName") {
        return "Untitled job";
      }

      if (key === "title") {
        return `Shared: ${values?.name ?? "Untitled job"}`;
      }

      if (key === "description") {
        return "Shared job description";
      }

      return key;
    };
  }),
}));

vi.mock("@/lib/services", () => ({
  jobService: {
    getPubliclySharedJob: (...args: unknown[]) =>
      getPubliclySharedJobMock(...args),
  },
}));

vi.mock("@/components/jobs", () => ({
  JobDetails: ({ job }: { job: { id: string } }) => (
    <div>
      {JOB_TEST_LABEL_PREFIX}
      {job.id}
    </div>
  ),
}));

function createSharedJobResult(overrides?: {
  allowSearchIndexing?: boolean;
  name?: string | null;
}) {
  return {
    share: {
      allowSearchIndexing: overrides?.allowSearchIndexing ?? true,
    },
    job: {
      id: "job_123",
      name: overrides?.name ?? "Shared Job",
      user: {
        name: "Ada Lovelace",
      },
      agent: {
        name: "Research Agent",
        overrideName: null,
        image: null,
        overrideImage: null,
      },
    },
  };
}

describe("share job page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns noindex metadata when search indexing is disabled", async () => {
    getPubliclySharedJobMock.mockResolvedValue(
      createSharedJobResult({ allowSearchIndexing: false }),
    );

    const { generateMetadata } = await import("./page");
    const metadata = await generateMetadata({
      params: Promise.resolve({ token: "public-share-token" }),
    });

    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      googleBot: {
        index: false,
        follow: false,
      },
    });
  });

  it("delegates missing shared jobs to notFound in metadata", async () => {
    getPubliclySharedJobMock.mockResolvedValue(null);

    const { generateMetadata } = await import("./page");

    await expect(
      generateMetadata({
        params: Promise.resolve({ token: "public-share-token" }),
      }),
    ).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("renders the shared job page from the service result", async () => {
    getPubliclySharedJobMock.mockResolvedValue(createSharedJobResult());

    const { default: JobPage } = await import("./page");
    render(
      await JobPage({
        params: Promise.resolve({ token: "public-share-token" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Research Agent" })).toBeVisible();
    expect(screen.getByText("job:job_123")).toBeVisible();
  });

  it("delegates missing shared jobs to notFound in the page", async () => {
    getPubliclySharedJobMock.mockResolvedValue(null);

    const { default: JobPage } = await import("./page");

    await expect(
      JobPage({
        params: Promise.resolve({ token: "public-share-token" }),
      }),
    ).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
