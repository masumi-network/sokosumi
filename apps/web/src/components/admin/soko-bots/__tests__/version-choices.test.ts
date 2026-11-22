import { describe, expect, it } from "vitest";

import { versionChoices } from "../version-choices";

const sokoBot = {
  versions: [
    { id: "v32", name: "v32" },
    { id: "v33", name: "v33" },
  ],
  defaultVersionId: "v33",
};

describe("versionChoices", () => {
  it("offers a Cuso only CMO's versions, with the hire default", () => {
    const choices = versionChoices("cmo-v2", sokoBot);

    const ids = choices.versions.map((version) => version.id);
    expect(ids).toContain("cmo-v2");
    expect(ids).toContain("cmo-v5");
    expect(ids.every((id) => id.startsWith("cmo-"))).toBe(true);
    expect(choices.defaultVersionId).toBe("cmo-v14");
  });

  it("offers any other bot only the Soko Bot versions", () => {
    expect(versionChoices("v31", sokoBot)).toEqual(sokoBot);
    expect(versionChoices(null, sokoBot)).toEqual(sokoBot);
  });
});
