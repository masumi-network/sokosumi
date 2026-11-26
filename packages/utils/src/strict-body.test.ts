import { describe, expect, it } from "vitest";
import { z } from "zod";

import { strictBody } from "./strict-body";

const body = strictBody({
  name: z.string(),
  discoverability: z.enum(["public", "private"]).optional(),
});

describe("strictBody", () => {
  it("passes a body with known keys", () => {
    expect(body.parse({ name: "x" })).toEqual({ name: "x" });
  });

  // SOKD-489: a guessed `visibility` was dropped and made a public channel.
  it("names the unknown key and lists the keys the body takes", () => {
    const result = body.safeParse({ name: "x", visibility: "private" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Unknown key "visibility". This body takes: name, discoverability.',
    );
  });

  it("names every unknown key", () => {
    const result = body.safeParse({ name: "x", email: "a", company: "b" });
    expect(result.error?.issues[0]?.message).toBe(
      'Unknown keys "email", "company". This body takes: name, discoverability.',
    );
  });

  it("keeps Zod's own message for other problems", () => {
    const result = body.safeParse({});
    expect(result.error?.issues[0]?.path).toEqual(["name"]);
  });
});
