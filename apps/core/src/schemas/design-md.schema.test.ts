import { describe, expect, it } from "vitest";

import {
  adHocDesignMdWriteSchema,
  designMdWriteSchema,
} from "./design-md.schema";

// SOKD-471: CLI callers sent only `content` and got "extractionId: expected string".
describe("DESIGN.md write bodies", () => {
  it.each([
    ["designMdWriteSchema", designMdWriteSchema],
    ["adHocDesignMdWriteSchema", adHocDesignMdWriteSchema],
  ] as const)("%s stores a body with only content", (_name, schema) => {
    expect(schema.parse({ content: "# E2E ws test" })).toEqual({
      content: "# E2E ws test",
      extractionId: null,
    });
  });

  it("keeps an extraction id that is sent", () => {
    expect(
      designMdWriteSchema.parse({ content: "# A", extractionId: "ext_1" }),
    ).toEqual({ content: "# A", extractionId: "ext_1" });
  });
});
