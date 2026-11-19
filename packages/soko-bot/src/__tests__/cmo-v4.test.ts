import { describe, expect, it } from "vitest";
import {
  CUSO_DESCRIPTION_REWRITES,
  CUSO_FORBIDDEN_WORDS,
  CUSO_IDENTITY,
} from "../cmo-texts.js";
import {
  isSokoBotNewsletterCapability,
  type SokoBotCapability,
} from "../policy.js";
import { SOKO_BOT_TOOL_DESCRIPTIONS } from "../tool-contracts.js";
import {
  CMO_SOKO_BOT_VERSION_ID,
  composeSystemPrompt,
  getSokoBotVersion,
  sokoBotIdentity,
  sokoBotToolDescription,
} from "../versions/index.js";

const v2 = getSokoBotVersion("cmo-v2");
const v4 = getSokoBotVersion("cmo-v4");
const REMOVED = [
  "manage_reminder",
  "list_chats",
  "read_chat",
  "link_tasks",
  "set_task_parent",
] as const;

/**
 * The tools whose words reach Cuso. The newsletter tools are offered only
 * where a newsletter is set up, and their rewording waits for CMO's own
 * newsletter flow.
 */
const tools = (v4.capabilities ?? []).filter(
  (capability) => !isSokoBotNewsletterCapability(capability),
);

/** Everything Cuso reads about himself and his tools on a turn. */
const read = [
  sokoBotIdentity(v4),
  composeSystemPrompt(v4, { name: "Cuso", shared: true }),
  ...tools.map((capability) => sokoBotToolDescription(capability, v4)),
].join("\n");

describe("cmo-v4", () => {
  it("is the version a new hire gets", () => {
    expect(CMO_SOKO_BOT_VERSION_ID).toBe("cmo-v4");
    expect(v4.profile).toBe("cmo");
    expect(v4.model).toBe(v2.model);
  });

  it("is cmo-v2 without the five tools that have no place in CMO", () => {
    expect(v4.capabilities).toEqual(
      v2.capabilities?.filter(
        (capability) => !(REMOVED as readonly string[]).includes(capability),
      ),
    );
    for (const capability of REMOVED) {
      expect(v2.capabilities).toContain(capability);
      expect(v4.capabilities).not.toContain(capability);
    }
    // What makes Cuso useful stays: tables, contacts, runs, Coworkers.
    expect(v4.capabilities).toEqual(
      expect.arrayContaining([
        "create_table",
        "write_table_rows",
        "export_contacts_to_table",
        "search_contacts",
        "manage_contact_lists",
        "start_background_run",
        "ask_coworker",
        "create_task",
        "hire_agent",
        "create_schedule",
      ]),
    );
  });

  it("reads the shared skills in Cuso's own words, and keeps cmo-v2's own", () => {
    expect(v4.skills).toEqual([
      "cmo-brand-brain-groups",
      "cmo-strategy-patches",
      "cmo-production",
      "cmo-daily-watch",
      "cmo-measurement",
      "cmo-seo",
      "cmo-launch-video",
      "cmo-social-posts",
      "cmo-long-work",
      "cmo-newsletter",
      "cmo-code-tools",
      "cmo-agent-jobs",
      "cmo-ask-coworker",
    ]);
  });

  it("never calls Cuso Soko Bot or names a Sokosumi place in what he reads", () => {
    expect(read).toContain(CUSO_IDENTITY);
    expect(read).toContain(
      "You are the CMO of the business in your Brand Brain",
    );
    expect(read.match(new RegExp(CUSO_FORBIDDEN_WORDS, "g"))).toBeNull();
    expect(
      read.match(/project manager|personal assistant|team assistant/gi),
    ).toBeNull();
    // No route into Sokosumi, and no tool he no longer has.
    expect(read.match(/\]\(\//g)).toBeNull();
    for (const capability of REMOVED) expect(read).not.toContain(capability);
  });

  it("tells Cuso to show what he made, never to link it", () => {
    expect(read).not.toContain("Link what you created");
    expect(read).toContain("Never write a link to it");
    expect(read).not.toMatch(/Return its link|present it\.|send its link/);
  });

  it("keeps Tasks with Coworkers and his rhythms as they are", () => {
    expect(read).toContain("A Task is work for a Coworker only.");
    expect(read).toContain("never change, pause or delete one");
    expect(read).toContain("is a new schedule of its own");
    const createTask = sokoBotToolDescription("create_task", v4);
    expect(createTask).not.toContain("assignToOwner");
    expect(createTask).not.toContain("memberId");
    expect(sokoBotToolDescription("assign_task", v4)).not.toContain(
      "assignToOwner",
    );
  });

  it("waits for a Coworker's answer instead of sleeping and reading the chat", () => {
    expect(read).toContain("`wait_for` with kind `chat_reply`");
    expect(read).not.toContain("sleep 60");
    expect(read).not.toContain("sleep 120");
  });

  it("rewords with rules that each still find their words", () => {
    const general = tools.map(
      (capability) => SOKO_BOT_TOOL_DESCRIPTIONS[capability] as string,
    );
    for (const [pattern] of CUSO_DESCRIPTION_REWRITES)
      expect(
        general.some((text) => new RegExp(pattern.source).test(text)),
        String(pattern),
      ).toBe(true);
  });

  it("leaves every other bot's words alone", () => {
    for (const version of [v2, getSokoBotVersion("v33")]) {
      expect(sokoBotIdentity(version)).toContain("You are Soko Bot");
      for (const capability of ["create_task", "list_files"] as const)
        expect(sokoBotToolDescription(capability, version)).toBe(
          SOKO_BOT_TOOL_DESCRIPTIONS[capability as SokoBotCapability],
        );
    }
    expect(composeSystemPrompt(v2, { name: "Cuso", shared: true })).toContain(
      "You are a shared team assistant inside Sokosumi",
    );
  });
});
