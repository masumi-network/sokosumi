import type { Contact } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  expandContactMentions,
  stripContactDetails,
  unlinkContacts,
} from "./task-contact-details";

const maya = {
  id: "c1",
  name: "Maya [Ops]",
  role: null,
  organization: null,
  location: null,
  channels: [],
} as unknown as Contact;

describe("task contact details", () => {
  it("round-trips: strip undoes expand, keeping text added after it", () => {
    const saved = expandContactMentions(
      "Call @c1:maya",
      new Map([["c1", maya]]),
      "Contacts",
    );
    expect(saved).toBe(
      "Call [Maya \\[Ops\\]](/contacts?contact=c1)\n\n<!-- sokosumi:contacts -->\n\n**Contacts**\n\n- **Maya [Ops]**\n\n<!-- /sokosumi:contacts -->",
    );
    expect(stripContactDetails(`${saved}\n\nAPI: due Friday`)).toBe(
      "Call [Maya \\[Ops\\]](/contacts?contact=c1)\n\nAPI: due Friday",
    );
  });

  it("leaves a marker that is not a generated block alone", () => {
    const code = "Example:\n\n```\n<!-- sokosumi:contacts -->\nkeep me\n```";
    expect(stripContactDetails(code)).toBe(code);
  });

  it("stays idempotent when contact fields span several lines", () => {
    const multiline = {
      ...maya,
      role: "Sales\nEurope",
      location: "Zurich\n<!-- /sokosumi:contacts -->",
    } as Contact;
    const save = (brief: string) =>
      expandContactMentions(brief, new Map([["c1", multiline]]), "Contacts");
    const first = save("Call @c1:maya");
    const brief = stripContactDetails(first);
    expect(brief).toBe("Call [Maya \\[Ops\\]](/contacts?contact=c1)");
    // Edit and save again, twice: the same single block, nothing left over.
    expect(save(brief)).toBe(first);
    expect(stripContactDetails(save(stripContactDetails(save(brief))))).toBe(
      brief,
    );
    // Only the two real markers stand on their own line.
    expect(
      first.split("\n").filter((line) => line.startsWith("<!--")),
    ).toHaveLength(2);
  });

  it("keeps a generated-looking block inside a fenced example", () => {
    const block = expandContactMentions(
      "",
      new Map([["c1", maya]]),
      "Contacts",
    );
    const example = `How it looks:\n\n~~~md\n${block}\n~~~\n\nThanks`;
    expect(stripContactDetails(example)).toBe(example);
    const saved = expandContactMentions(
      example,
      new Map([["c1", maya]]),
      "Contacts",
    );
    expect(stripContactDetails(saved)).toBe(example);
  });

  it("keeps only the name of a contact that is gone", () => {
    expect(
      expandContactMentions(
        "Ask [Old](/contacts?contact=c2)",
        new Map([["c2", null]]),
        "Contacts",
      ),
    ).toBe("Ask Old");
  });

  it("turns contact links into plain names", () => {
    expect(
      unlinkContacts("Call [Maya \\[Ops\\]](/contacts?contact=c1) or [x](/y)"),
    ).toBe("Call Maya \\[Ops\\] or [x](/y)");
  });
});
