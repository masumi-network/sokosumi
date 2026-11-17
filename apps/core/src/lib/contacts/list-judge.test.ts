import { describe, expect, it, vi } from "vitest";

const { askJev } = vi.hoisted(() => ({ askJev: vi.fn() }));
vi.mock("@/lib/soko-bot/jev", () => ({ askJev }));

import { expectCoreLogWhys } from "@/test/core-log";
import { judgeListMemberships } from "./list-judge";

const contact = {
  name: "Sam Founder",
  kind: "PERSON",
  organization: "Founder Dev",
  role: null,
  stage: "LEAD",
  summary: null,
  domains: ["founder.dev"],
  topics: ["Intro"],
};

describe("judgeListMemberships", () => {
  it("returns null when Jev fails, logging only safe fields", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Could not check which contact lists a contact belongs on",
      ["Jev, the judging model, failed or timed out"],
    );
    // A model error can quote the contact data it was sent.
    askJev.mockRejectedValue(new Error('timeout judging "Sam Founder"'));

    await expect(
      judgeListMemberships(contact, [
        { id: "list_1", name: "Investors", description: null },
      ]),
    ).resolves.toBeNull();

    expect(warnings[0]?.event).toMatchObject({
      operation: "contact_list_judge",
      failure: { errorName: "Error" },
    });
    expect(JSON.stringify(warnings[0]?.event)).not.toContain("Sam Founder");
  });
});
