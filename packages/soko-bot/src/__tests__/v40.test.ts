import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
} from "../versions/index.js";

describe("v40", () => {
  const v39 = getSokoBotVersion("v39");
  const v40 = getSokoBotVersion("v40");

  it("is v39 with the plan loop on and nothing else changed", () => {
    const { id, name, summary, createdAt, planLoop, ...rest } = v40;
    const {
      id: _id,
      name: _name,
      summary: _summary,
      createdAt: _createdAt,
      ...was
    } = v39;
    expect(id).toBe("v40");
    expect(planLoop).toBe(true);
    expect(v39.planLoop).toBeUndefined();
    expect(rest).toEqual(was);
  });

  it("is not the default", () => {
    expect(DEFAULT_SOKO_BOT_VERSION_ID).not.toBe("v40");
  });
});
