import { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JobInputsFormBuilder } from "@/components/job-input/job-inputs-form-builder";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "formatted-date",
  }),
}));

vi.mock("@/components/markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => {
    return <div data-testid="markdown-mock">{children}</div>;
  },
}));

describe("DateInput", () => {
  it("shows the translated placeholder when no date is selected", () => {
    const inputFields: InputFieldSchemaType[] = [
      {
        id: "start-date",
        type: InputType.DATE,
        name: "Start date",
        data: {},
        validations: null,
      },
    ];

    render(
      <JobInputsFormBuilder
        inputFields={inputFields}
        onSubmit={vi.fn()}
        renderFooter={() => <button type="submit">Submit</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "pickDate" }),
    ).toBeInTheDocument();
  });

  it("formats a selected date with next-intl instead of the runtime locale", () => {
    const inputFields: InputFieldSchemaType[] = [
      {
        id: "start-date",
        type: InputType.DATE,
        name: "Start date",
        data: {
          default: "2026-01-19",
        },
        validations: null,
      },
    ];

    render(
      <JobInputsFormBuilder
        inputFields={inputFields}
        onSubmit={vi.fn()}
        renderFooter={() => <button type="submit">Submit</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "formatted-date" }),
    ).toBeInTheDocument();
  });
});
