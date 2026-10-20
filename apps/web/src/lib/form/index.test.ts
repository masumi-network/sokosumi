import { describe, expectTypeOf, it } from "vitest";

import type { FormData } from "./index";

describe("FormData translation keys", () => {
  it("accepts keys from the chosen form and rejects unrelated keys", () => {
    type Label = NonNullable<
      FormData<
        { name: string },
        "Components.Organizations.InformationModal.Form"
      >[number]["labelKey"]
    >;

    expectTypeOf<
      Extract<Label, "Fields.Name.label" | "Fields.Url.placeholder">
    >().toEqualTypeOf<"Fields.Name.label" | "Fields.Url.placeholder">();
    expectTypeOf<
      Extract<Label, "research.title" | "Fields.Unknown.label">
    >().toBeNever();
  });

  it("rejects a namespace that is not a form", () => {
    // @ts-expect-error Only existing Form namespaces are accepted.
    type NonForm = FormData<{ name: string }, "Auth.Email">;
    expectTypeOf<NonForm>().toBeArray();
  });
});
