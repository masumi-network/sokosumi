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
