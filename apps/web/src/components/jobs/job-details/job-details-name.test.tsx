import type { Job } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import JobDetailsName, {
  useJobDetailsNameController,
} from "@/components/jobs/job-details/job-details-name";
import { updateJobName } from "@/lib/actions/job/action";
import { getJobQueryKey } from "@/queries/jobs";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/actions/errors/error-codes/common", () => ({
  CommonErrorCode: {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    UNAUTHORIZED: "UNAUTHORIZED",
  },
}));
vi.mock("@/lib/actions/errors/error-codes/job", () => ({
  JobErrorCode: {
    JOB_NOT_FOUND: "JOB_NOT_FOUND",
  },
}));
vi.mock("@/lib/actions/job/action", () => ({
  updateJobName: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/actions/job/get-job.action", () => ({ getJob: vi.fn() }));

function TestHarness({ editing = false }: { editing?: boolean }) {
  const form = useForm({
    defaultValues: {
      name: "Shared Job",
    },
  });

  return (
    <JobDetailsName
      editing={editing}
      name="Shared Job"
      form={form}
      handleSubmit={vi.fn()}
      handleCancel={vi.fn()}
    />
  );
}

describe("JobDetailsName", () => {
  it("renders only the job name in view mode", () => {
    render(<TestHarness />);

    expect(screen.getByText("Shared Job")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the inline form only while editing", () => {
    render(<TestHarness editing />);

    expect(
      screen.getByPlaceholderText("Form.Name.placeholder"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "save",
      }),
    ).toBeInTheDocument();
  });
});

describe("useJobDetailsNameController", () => {
  it("writes the new name to the job query, which the page reads", async () => {
    vi.mocked(updateJobName).mockResolvedValue({ ok: true, value: undefined });
    const queryClient = new QueryClient();
    const job = { id: "job-1", name: "Old name" } as Job;
    queryClient.setQueryData(getJobQueryKey(job.id), job);

    const { result } = renderHook(() => useJobDetailsNameController(job), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });

    await act(() => result.current.submit({ name: "New name" }));

    expect(queryClient.getQueryData<Job>(getJobQueryKey(job.id))?.name).toBe(
      "New name",
    );
  });

  it("renders on a page with no query provider (the public share page)", () => {
    const job = { id: "job-1", name: "Shared Job" } as Job;

    const { result } = renderHook(() => useJobDetailsNameController(job));

    expect(result.current.editing).toBe(false);
  });
});
