import { hashInputSchema } from "@sokosumi/masumi/hash";
import { describe, expect, it } from "vitest";

import { resolveInputSchemaHash } from "./post";

describe("resolveInputSchemaHash", () => {
  it("computes hash from inputSchema", () => {
    const inputSchema = JSON.stringify([
      {
        id: "prompt",
        name: "Prompt",
        type: "string",
      },
    ]);

    expect(resolveInputSchemaHash(inputSchema)).toBe(hashInputSchema(inputSchema));
  });

  it("throws when input schema cannot be hashed", () => {
    expect(() => resolveInputSchemaHash("not-json")).toThrow(
      "Agent provided an invalid input schema",
    );
  });
});
