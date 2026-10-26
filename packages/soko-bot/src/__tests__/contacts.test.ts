import { describe, expect, it } from "vitest";
import { SOKO_BOT_SLACK_CAPTURE_TOOLS } from "../integrations.js";
import {
  capabilitiesForClassification,
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES,
  type TurnClassification,
} from "../policy.js";
import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "../tool-contracts.js";
import {
  composeSystemPrompt,
  getSokoBotSkill,
  getSokoBotVersion,
} from "../versions/index.js";

const READS = [
  "search_contacts",
  "get_contact",
  "list_contact_lists",
  "find_contact_duplicates",
] as const;
const WRITES = [
  "upsert_contact",
  "update_contact",
  "log_contact_interaction",
  "merge_contacts",
  "manage_contact_lists",
] as const;
const ID = "0199f1c2-7a3b-7c1d-9e2f-3a4b5c6d7e8f";

describe("contacts capabilities", () => {
  it("read on every owner route, read-only routes included", () => {
    for (const route of Object.values(SOKO_BOT_ROUTE_CAPABILITIES))
      for (const read of READS) expect(route).toContain(read);
  });

  it("write on the work routes and on a file request, never read-only", () => {
    for (const route of ["DELEGATE_TASK", "HIRE_AGENT", "MANAGE_WORK"] as const)
      for (const write of WRITES)
        expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).toContain(write);
    for (const route of ["DIRECT_RESPONSE", "CLARIFY", "MIXED"] as const)
      for (const write of WRITES)
        expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).not.toContain(write);
    const classification: TurnClassification = {
      schemaVersion: 1,
      route: "MANAGE_WORK",
      writeScope: "FILE",
      confidence: 1,
      rationaleSummary: "explicit",
      requestedOutcome: "add Nina to my contacts",
      candidateProjectIds: [],
      candidateCoworkerIds: [],
      candidateAgentIds: [],
      requiresApproval: false,
      requiresClarification: false,
    };
    expect(capabilitiesForClassification(classification)).toEqual(
      expect.arrayContaining([...READS, ...WRITES]),
    );
    expect(
      capabilitiesForClassification({
        ...classification,
        writeScope: "MEMORY",
      }),
    ).not.toContain("upsert_contact");
  });

  it("stay off the bot-to-bot ceiling and stay usable after web research", () => {
    for (const capability of [...READS, ...WRITES]) {
      expect(
        SOKO_BOT_BOT_TO_BOT_CAPABILITIES as readonly string[],
      ).not.toContain(capability);
      // Prospect research reads the web and then saves what it verified.
      expect(
        SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES as readonly string[],
      ).not.toContain(capability);
    }
  });
});

describe("contacts tool inputs", () => {
  it("search with filters and defaults", () => {
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.search_contacts.parse({
        search: "acme",
        stages: ["PROSPECT"],
        listId: ID,
      }),
    ).toEqual({
      search: "acme",
      stages: ["PROSPECT"],
      listId: ID,
      sort: "lastContactAt",
      limit: 25,
    });
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.search_contacts.safeParse({ owner: "me" })
        .success,
    ).toBe(false);
  });

  it("upsert needs a name or a channel and takes research provenance", () => {
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.upsert_contact.safeParse({ role: "CTO" })
        .success,
    ).toBe(false);
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.upsert_contact.parse({
        name: "Nina Keller",
        stage: "PROSPECT",
        whyInteresting: "Runs the EU pilot program",
        channels: [
          {
            type: "LINKEDIN",
            value: "linkedin.com/in/nina",
            source: "WEB_RESEARCH",
            sourceUrl: "https://example.com/team",
          },
        ],
      }),
    ).toMatchObject({
      name: "Nina Keller",
      channels: [{ source: "WEB_RESEARCH" }],
    });
  });

  it("update needs the contact's version, and every field is settable", () => {
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.update_contact.safeParse({
        contactId: ID,
        stage: "ACTIVE",
      }).success,
    ).toBe(false);
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.update_contact.safeParse({
        contactId: ID,
        version: 3,
        name: "Nina K.",
        organization: null,
        role: "CTO",
        location: "Zurich",
        summary: "Met at a conference.",
        whyInteresting: "Pilot buyer",
        stage: "ACTIVE",
        nextStep: "Send pricing",
        followUpAt: "2026-11-02",
        avatarUrl: "https://example.com/nina.png",
        customFields: { fund: "II" },
        addChannels: [{ type: "EMAIL", value: "nina@example.com" }],
        removeChannelIds: [ID],
        archived: false,
      }).success,
    ).toBe(true);
  });

  it("logs interactions with a one-line topic", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.log_contact_interaction;
    expect(
      schema.safeParse({
        contactId: ID,
        occurredAt: "2026-10-22T10:00:00Z",
        channel: "MEETING",
        summary: "Pricing for the Q3 pilot",
        sourceRef: "evt_1",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        contactId: ID,
        occurredAt: "2026-10-22T10:00:00Z",
        channel: "MEETING",
        summary: "x".repeat(301),
      }).success,
    ).toBe(false);
  });

  it("checks that each list action names what it needs", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.manage_contact_lists;
    expect(schema.safeParse({ action: "create", name: "VIP" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ action: "create" }).success).toBe(false);
    expect(schema.safeParse({ action: "delete" }).success).toBe(false);
    expect(schema.safeParse({ action: "add", listId: ID }).success).toBe(false);
    expect(
      schema.safeParse({ action: "add", listId: ID, contactIds: [ID] }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        action: "update",
        listId: ID,
        smartFilter: { stages: ["INVESTOR"], knownByMe: true },
      }).success,
    ).toBe(true);
  });
});

describe("v28", () => {
  it("is v27 with the contacts skill", () => {
    const v27 = getSokoBotVersion("v27");
    const v28 = getSokoBotVersion("v28");
    expect(v28.skills).toEqual([...v27.skills, "contacts"]);
    expect(v28.model).toBe(v27.model);
    expect(v28.capabilities).toBe(v27.capabilities);
    const prompt = composeSystemPrompt(v28);
    expect(prompt).toContain(getSokoBotSkill("contacts").content.trim());
    expect(prompt).toContain(composeSystemPrompt(v27));
    expect(composeSystemPrompt(v27)).not.toContain("# Contacts");
  });
});

describe.each(["contacts", "team-contacts"])("the %s skill", (id) => {
  it("teaches search before adding, sources for research, and no spam", () => {
    const skill = getSokoBotSkill(id).content;
    for (const tool of [...READS.slice(0, 3), ...WRITES])
      expect(skill).toContain(`\`${tool}\``);
    expect(skill).toMatch(/Never create a duplicate/);
    expect(skill).toMatch(/WEB_RESEARCH/);
    expect(skill).toMatch(/noreply/);
  });

  it("walks prospect research step by step, with verified sources only", () => {
    const skill = getSokoBotSkill(id).content;
    const prospects = skill.slice(skill.indexOf("## Prospects"));
    expect(prospects).not.toBe(skill);
    for (const step of [
      "`search_contacts` first",
      "`web_search` and `web_fetch`",
      "Never guess an email",
      "stage PROSPECT",
      "`whyInteresting`",
      "`sourceUrl`",
      "set `verified` only when",
      "with the sources",
    ])
      expect(prospects).toContain(step);
  });

  it("knows capture logs mail, meetings and Slack, so it does not log them again", () => {
    const skill = getSokoBotSkill(id).content;
    expect(skill).toMatch(/captured on their own/);
    expect(skill).toMatch(/Do not log those touchpoints again/);
    expect(skill).toContain("`find_contact_duplicates`");
  });
});

describe("Slack capture tools", () => {
  it("belong to the Slack toolkit, which Core's tool runner requires", () => {
    const { provider, ...tools } = SOKO_BOT_SLACK_CAPTURE_TOOLS;
    expect(provider).toBe("slack");
    for (const slug of Object.values(tools))
      expect(slug.startsWith("SLACK_")).toBe(true);
  });
});
