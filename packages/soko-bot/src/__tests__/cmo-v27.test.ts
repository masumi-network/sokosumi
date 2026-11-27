import { describe, expect, it } from "vitest";
import {
  CMO_SOKO_BOT_VERSION_ID,
  CMO_SOKO_BOT_VERSION_IDS,
  getSokoBotVersion,
} from "../versions/index.js";

describe("cmo-v27", () => {
  const v26 = getSokoBotVersion("cmo-v26");
  const v27 = getSokoBotVersion("cmo-v27");

  it("is cmo-v26 with the plan loop on and nothing else changed", () => {
    const { id, name, summary, createdAt, planLoop, ...rest } = v27;
    const {
      id: _id,
      name: _name,
      summary: _summary,
      createdAt: _createdAt,
      ...was
    } = v26;
    expect(id).toBe("cmo-v27");
    expect(planLoop).toBe(true);
    expect(v26.planLoop).toBeUndefined();
    expect(rest).toEqual(was);
  });

  it("is a Cuso version, not the default", () => {
    expect(CMO_SOKO_BOT_VERSION_IDS).toContain("cmo-v27");
    expect(CMO_SOKO_BOT_VERSION_ID).not.toBe("cmo-v27");
  });
});
