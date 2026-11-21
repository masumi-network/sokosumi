import { describe, expect, it } from "vitest";
import { authoredTaskBrief } from "./task-contact-details.js";

const block = (heading: string, line: string) =>
  `<!-- sokosumi:contacts -->\n\n**${heading}**\n\n- ${line}\n\n<!-- /sokosumi:contacts -->`;

describe("authoredTaskBrief", () => {
  it("ignores the rebuilt details block and where contact links point", () => {
    expect(
      authoredTaskBrief(
        `Call [Maya](/contacts?contact=c1) today\n\n${block("Contacts", "**Maya** · maya@old.example")}`,
      ),
    ).toBe(
      authoredTaskBrief(
        `Call [Maya Lee](/contacts?contact=c2) today\n\n${block("Kontakte", "**Maya Lee** · +49 30 1234")}`,
      ),
    );
  });

  it("still sees a change to the text a person wrote", () => {
    expect(
      authoredTaskBrief("Call [Maya](/contacts?contact=c1) today"),
    ).not.toBe(authoredTaskBrief("Call [Maya](/contacts?contact=c1) tomorrow"));
  });
});
