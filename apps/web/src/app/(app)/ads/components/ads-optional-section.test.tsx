import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

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
