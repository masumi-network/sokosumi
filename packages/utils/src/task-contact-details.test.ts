import { describe, expect, it } from "vitest";
import {
  sameAuthoredBrief,
  stripContactDetails,
} from "./task-contact-details.js";

const block = (heading: string, line: string) =>
  `<!-- sokosumi:contacts -->\n\n**${heading}**\n\n- ${line}\n\n<!-- /sokosumi:contacts -->`;

describe("sameAuthoredBrief", () => {
  it("ignores the rebuilt details block and where contact links point", () => {
    expect(
      sameAuthoredBrief(
        `Call [Maya](/contacts?contact=c1) today\n\n${block("Contacts", "**Maya** · maya@old.example")}`,
        `Call [Maya Lee](/contacts?contact=c2) today\n\n${block("Kontakte", "**Maya Lee** · +49 30 1234")}`,
      ),
    ).toBe(true);
  });

  it("ignores a link a save turned back into its label", () => {
    expect(
      sameAuthoredBrief(
        `Call [Maya \\[ops\\]](/contacts?contact=c1) about February\n\n${block("Contacts", "**Maya** · maya@old.example")}`,
        "Call Maya \\[ops\\] about February",
      ),
    ).toBe(true);
  });

  it("still sees a change to the text a person wrote", () => {
    expect(
      sameAuthoredBrief(
        "Call [Maya](/contacts?contact=c1) today",
        "Call [Maya](/contacts?contact=c1) tomorrow",
      ),
    ).toBe(false);
    expect(
      sameAuthoredBrief(
        "Call [Maya](/contacts?contact=c1) today",
        "Call Maya tomorrow",
      ),
    ).toBe(false);
    expect(
      sameAuthoredBrief(
        "Call [Maya](/contacts?contact=c1) today",
        "Call Bob today",
      ),
    ).toBe(false);
  });
});

describe("stripContactDetails", () => {
  it("removes the details after a fence that never closes", () => {
    expect(
      stripContactDetails(
        `Run this:\n\n\`\`\`sh\nnpm test\n\n${block("Contacts", "**Maya** · maya@example.com")}`,
      ),
    ).toBe("Run this:\n\n```sh\nnpm test");
  });

  it("keeps markers inside a closed fence", () => {
    const example = `\`\`\`md\n${block("Contacts", "**Maya** · maya@example.com")}\n\`\`\``;
    expect(stripContactDetails(example)).toBe(example);
  });
});
