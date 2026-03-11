import {
  COWORKER_CAPABILITIES,
  filterCoworkersByCapability,
  hasCoworkerCapability,
} from "@/lib/utils/coworker-capability";

describe("coworker-capability utils", () => {
  it("exports the supported capabilities", () => {
    expect(COWORKER_CAPABILITIES).toEqual(["chat", "tasks"]);
  });

  it("returns true when a coworker has the requested capability", () => {
    expect(
      hasCoworkerCapability({ capabilities: ["tasks", "chat"] }, "chat"),
    ).toBe(true);
  });

  it("returns false when capabilities are missing or empty", () => {
    expect(hasCoworkerCapability({ capabilities: [] }, "tasks")).toBe(false);
    expect(hasCoworkerCapability({}, "tasks")).toBe(false);
  });

  it("filters coworkers by the requested capability", () => {
    const coworkers = [
      { id: "c1", capabilities: ["chat"] },
      { id: "c2", capabilities: ["tasks"] },
      { id: "c3", capabilities: ["chat", "tasks"] },
      { id: "c4", capabilities: [] },
    ];

    expect(filterCoworkersByCapability(coworkers, "chat")).toEqual([
      { id: "c1", capabilities: ["chat"] },
      { id: "c3", capabilities: ["chat", "tasks"] },
    ]);
    expect(filterCoworkersByCapability(coworkers, "tasks")).toEqual([
      { id: "c2", capabilities: ["tasks"] },
      { id: "c3", capabilities: ["chat", "tasks"] },
    ]);
  });
});
