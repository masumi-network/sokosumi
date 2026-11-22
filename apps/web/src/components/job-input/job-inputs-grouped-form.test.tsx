import type { InputGroupSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import english from "../../../messages/en.json";
import { JobInputsGroupedForm } from "./job-inputs-grouped-form";

const GROUPS: InputGroupSchemaType[] = [
  {
    id: "step-1",
    title: "Basics",
    input_data: [
      {
        id: "brand",
        type: InputType.TEXT,
        name: "Brand",
      },
    ],
  },
  {
    id: "step-2",
    title: "Goal",
    input_data: [
      {
        id: "objective",
        type: InputType.TEXT,
        name: "Objective",
      },
    ],
  },
];

function Harness({
  onSubmit,
}: {
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [maxUnlockedGroupIndex, setMaxUnlockedGroupIndex] = useState(0);

  return (
    <NextIntlClientProvider locale="en" messages={english}>
      <JobInputsGroupedForm
        groups={GROUPS}
        activeGroupIndex={activeGroupIndex}
        maxUnlockedGroupIndex={maxUnlockedGroupIndex}
        goToNext={() => {
          setActiveGroupIndex((index) => {
            const next = Math.min(index + 1, GROUPS.length - 1);
            setMaxUnlockedGroupIndex((max) => Math.max(max, next));
            return next;
          });
        }}
        goToGroup={(index) => setActiveGroupIndex(index)}
        reset={() => {
          setActiveGroupIndex(0);
          setMaxUnlockedGroupIndex(0);
        }}
        customOnSubmit={onSubmit}
        customRenderGroupFooter={({ isValid }, isLast, groupIndex) => (
          <button
            type="submit"
            disabled={!isValid}
            data-testid={`submit-group-${groupIndex}`}
          >
            {isLast ? "Submit" : "Next"}
          </button>
        )}
        customIsSubmitting={false}
        customIsActive
      />
    </NextIntlClientProvider>
  );
}

describe("JobInputsGroupedForm", () => {
  it("preserves edits made in an earlier group when switching tabs without clicking Next", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const brandInput = screen.getByLabelText(/Brand/i);
    fireEvent.change(brandInput, { target: { value: "Acme" } });
    await waitFor(() => {
      expect(screen.getByTestId("submit-group-0")).toBeEnabled();
    });
    fireEvent.click(screen.getByTestId("submit-group-0"));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Goal" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    const objectiveInput = screen.getByLabelText(/Objective/i);
    fireEvent.change(objectiveInput, { target: { value: "Launch" } });
    await waitFor(() => {
      expect(screen.getByTestId("submit-group-1")).toBeEnabled();
    });

    // Switch back to tab 1, edit Brand, then jump straight back to tab 2 via the tab bar.
    fireEvent.click(screen.getByRole("tab", { name: "Basics" }));
    fireEvent.change(brandInput, { target: { value: "Acme Revised" } });
    fireEvent.click(screen.getByRole("tab", { name: "Goal" }));

    fireEvent.click(screen.getByTestId("submit-group-1"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        brand: "Acme Revised",
        objective: "Launch",
      });
    });
  });
});
