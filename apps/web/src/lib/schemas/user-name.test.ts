import { describe, expect, it } from "vitest";

import { accountNameFormSchema, firstAndLastNameFormSchema } from "./account";
import { signUpFormSchema } from "./auth";

describe.each([
  ["signup", signUpFormSchema()],
  ["onboarding and invitations", firstAndLastNameFormSchema()],
  ["account", accountNameFormSchema(undefined, { namePartsRequired: true })],
])("%s combined name limit", (_label, schema) => {
  const otherFields = {
    name: "Chosen display name",
    email: "ada@example.com",
    password: "Password123!",
  };

  it.each([
    { firstName: "a".repeat(100), lastName: "b".repeat(27) },
    { firstName: "a".repeat(27), lastName: "b".repeat(100) },
  ])("accepts 128 characters with either part over 64", (parts) => {
    expect(schema.safeParse({ ...otherFields, ...parts }).success).toBe(true);
  });

  it("rejects 129 characters including the joining space", () => {
    const result = schema.safeParse({
      ...otherFields,
      firstName: "a".repeat(64),
      lastName: "b".repeat(64),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ["lastName"] }),
      ]);
    }
  });

  it("counts trimmed names", () => {
    const result = schema.parse({
      ...otherFields,
      firstName: `  ${"a".repeat(100)}  `,
      lastName: `  ${"b".repeat(27)}  `,
    });

    expect(result.firstName).toHaveLength(100);
    expect(result.lastName).toHaveLength(27);
  });

  it.each([
    { firstName: " ", lastName: "Lovelace" },
    { firstName: "Ada", lastName: " " },
  ])("still requires both name parts", (parts) => {
    expect(schema.safeParse({ ...otherFields, ...parts }).success).toBe(false);
  });
});

describe("legacy account names", () => {
  const schema = accountNameFormSchema(undefined, { namePartsRequired: false });

  it("allows both parts to remain empty", () => {
    expect(
      schema.safeParse({ firstName: "", lastName: "", name: "Display name" })
        .success,
    ).toBe(true);
  });

  it("requires the other part when one is supplied", () => {
    expect(
      schema.safeParse({ firstName: "Ada", lastName: "", name: "Display name" })
        .success,
    ).toBe(false);
  });

  it("keeps the independent display name limit", () => {
    expect(
      schema.safeParse({ firstName: "", lastName: "", name: "a".repeat(129) })
        .success,
    ).toBe(false);
  });
});
