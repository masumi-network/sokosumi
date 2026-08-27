import { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JobInputsFormBuilder } from "@/components/job-input/job-inputs-form-builder";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => {
    return <div data-testid="markdown-mock">{children}</div>;
  },
}));

describe("NoneInput", () => {
  it("renders readonly markdown description for none field", () => {
    const inputFields: InputFieldSchemaType[] = [
      {
        id: "readonly-info",
        type: InputType.NONE,
        name: "Readonly info",
        data: {
          description: "**Read only** [docs](https://example.com)",
        },
      },
    ];

    render(
      <JobInputsFormBuilder
        inputFields={inputFields}
        onSubmit={vi.fn()}
        renderFooter={() => <button type="submit">Submit</button>}
      />,
    );

    expect(screen.getByText("Readonly info")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-mock")).toHaveTextContent(
      "**Read only** [docs](https://example.com)",
    );
  });
});
