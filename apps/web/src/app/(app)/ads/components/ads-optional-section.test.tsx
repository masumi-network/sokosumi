import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import * as z from "zod";

import { AdsOptionalSection } from "./ads-optional-section";

const REFUSED = { values: {}, errors: { field: { type: "x", message: "no" } } };

/** A form whose submit is always refused for a field inside the section. */
function Harness() {
  const form = useForm({ resolver: async () => REFUSED });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(() => undefined)}>
        <AdsOptionalSection
          invalid={!!form.formState.errors.field}
          summary={null}
          title="Extras"
        >
          <p>Inside</p>
        </AdsOptionalSection>
        <button type="submit">Save</button>
      </form>
    </FormProvider>
  );
}

const toggle = () => screen.getByRole("button", { name: "Extras" });
const expanded = () => toggle().getAttribute("aria-expanded");

describe("AdsOptionalSection", () => {
  it("opens and closes on click", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    expect(expanded()).toBe("false");
    expect(screen.queryByText("Inside")).toBeNull();

    await user.click(toggle());
    expect(expanded()).toBe("true");
    expect(screen.getByText("Inside")).toBeVisible();

    await user.click(toggle());
    expect(expanded()).toBe("false");
  });

  it("opens when a submit is refused for something inside, and can be closed again", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(expanded()).toBe("true");

    await user.click(toggle());
    expect(expanded()).toBe("false");
    await user.click(toggle());
    expect(expanded()).toBe("true");
  });

  it("opens again on the next refused submit", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(toggle());
    expect(expanded()).toBe("false");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(expanded()).toBe("true");
  });
});

const checkSchema = z.object({
  field: z.string().min(1, "no"),
  other: z.string().min(1, "no"),
});

function StepCheckHarness() {
  const form = useForm({
    resolver: zodResolver(checkSchema),
    mode: "onTouched",
    defaultValues: { field: "", other: "" },
  });

  return (
    <FormProvider {...form}>
      <AdsOptionalSection
        invalid={!!form.formState.errors.field}
        name="field"
        summary={null}
        title="Extras"
      >
        <input aria-label="Extra" {...form.register("field")} />
      </AdsOptionalSection>
      <input aria-label="Other" {...form.register("other")} />
      <button type="button" onClick={() => void form.trigger("field")}>
        Next
      </button>
      <button type="button" onClick={() => void form.trigger("other")}>
        Check other
      </button>
    </FormProvider>
  );
}

describe("AdsOptionalSection already refused", () => {
  it("opens when it first appears already holding a refusal", () => {
    function AlreadyRefused() {
      const form = useForm();
      return (
        <FormProvider {...form}>
          <AdsOptionalSection invalid summary={null} title="Extras">
            <p>Inside</p>
          </AdsOptionalSection>
        </FormProvider>
      );
    }

    render(<AlreadyRefused />);

    expect(expanded()).toBe("true");
    expect(screen.getByText("Inside")).toBeVisible();
  });
});

describe("AdsOptionalSection step check", () => {
  it("opens again when Next still finds a refusal after the reader closed it", async () => {
    render(<StepCheckHarness />);
    const user = userEvent.setup();

    await user.click(toggle());
    await user.click(screen.getByRole("textbox", { name: "Extra" }));
    await user.tab();
    expect(expanded()).toBe("true");

    await user.click(toggle());
    expect(expanded()).toBe("false");

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(expanded()).toBe("true");
  });

  it("stays closed when a check of another field still leaves this one refused", async () => {
    render(<StepCheckHarness />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(expanded()).toBe("true");
    await user.click(toggle());
    expect(expanded()).toBe("false");

    await user.click(screen.getByRole("button", { name: "Check other" }));

    expect(expanded()).toBe("false");
  });
});
