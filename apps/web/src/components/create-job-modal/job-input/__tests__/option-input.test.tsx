import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import { InputType, InputValidation } from "@sokosumi/masumi/types";

import { JobInputsFormBuilder } from "@/components/create-job-modal/job-input/job-inputs-form-builder";

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

jest.mock("@/components/markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => {
    return <div data-testid="markdown-mock">{children}</div>;
  },
}));

describe("OptionInput", () => {
  it("renders single select when option values include an empty string", () => {
    const inputFields: InputFieldSchemaType[] = [
      {
        id: "single-option",
        type: InputType.OPTION,
        name: "Single option",
        data: {
          values: ["", "Alternative"],
        },
        validations: [
          {
            validation: InputValidation.MAX,
            value: "1",
          },
        ],
      },
    ];

    expect(() =>
      render(
        <JobInputsFormBuilder
          inputFields={inputFields}
          onSubmit={jest.fn()}
          renderFooter={() => <button type="submit">Submit</button>}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
