import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import JobDetailsName from "@/components/jobs/job-details/job-details-name";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/actions", () => ({
  CommonErrorCode: {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    UNAUTHORIZED: "UNAUTHORIZED",
  },
  JobErrorCode: {
    JOB_NOT_FOUND: "JOB_NOT_FOUND",
  },
  updateJobName: vi.fn(),
}));

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
