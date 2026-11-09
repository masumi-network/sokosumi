import { SOKO_BOT_CAPABILITIES } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { EVAL_CASES, selectEvalCases } from "./eval-cases";

/** The tools a case checks the bot calls, or does not call. */
function toolsCaseChecks(): Set<string> {
  const tools = new Set<string>();
  for (const evalCase of EVAL_CASES) {
    if (evalCase.kind === "cmo-research") tools.add("save_brand_brain");
    if (evalCase.kind === "cmo-strategy") tools.add("save_strategy");
    if (evalCase.kind !== "scenario") continue;
    const { expect: wanted } = evalCase.scenario;
    for (const tool of [
      ...(wanted.tools ?? []),
      ...(wanted.anyTools ?? []),
      ...(wanted.forbiddenTools ?? []),
    ])
      tools.add(tool);
  }
  return tools;
}

/**
 * Tools no eval case checks yet. This list only shrinks: a new tool gets a
 * case before it ships, and a tool that gains one leaves the list.
 */
const NOT_YET_COVERED = new Set([
  "ask_coworker",
  "create_ad_campaign",
  "create_project",
  "delete_ad_campaign",
  "edit_ad_campaign",
  "enrich_contact",
  "find_people",
  "log_contact_interaction",
  "manage_contact_lists",
  "merge_contacts",
  "update_ad_campaign",
  "update_assigned_task",
  "update_contact",
  "update_project",
  "update_task",
  "bulk_update_contacts",
  "cancel_social_post",
  "delete_file",
  "draft_email",
  "evaluate_with_jev",
  "export_contacts_to_table",
  "find_ad_targeting",
  "find_contact_duplicates",
  "find_integrations",
  "generate_image",
  "generate_video",
  "generate_voiceover",
  "get_ad_campaign",
  "get_agent_input_schema",
  "get_company",
  "get_image",
  "get_job_status",
  "get_market_keywords",
  "get_newsletter",
  "get_newsletter_analytics",
  "get_newsletter_issue",
  "get_posting_instructions",
  "get_social_post",
  "get_video",
  "handle_social_comment",
  "install_skill",
  "list_ad_accounts",
  "list_ad_campaigns",
  "list_background_runs",
  "list_contact_lists",
  "list_integration_tools",
  "list_integrations",
  "list_newsletter_issues",
  "list_newsletter_subscribers",
  "list_skills",
  "list_social_account_statistics",
  "list_social_comments",
  "list_social_post_statistics",
  "list_tables",
  "manage_reminder",
  "move_file",
  "open_direct_chat",
  "preview_newsletter_issue",
  "preview_newsletter_signup_form",
  "preview_result",
  "provide_job_input",
  "read_email",
  "read_integration_tool",
  "read_memory",
  "read_social_profile",
  "read_table",
  "read_writing_skill",
  "refresh_social_account_statistics",
  "refresh_social_post_statistics",
  "remove_newsletter_subscriber",
  "remove_skill",
  "report_update",
  "save_email_attachment",
  "search_companies",
  "search_exa",
  "stop_background_run",
  "update_company",
  "update_emails",
  "update_newsletter_issue",
  "update_newsletter_settings",
  "update_newsletter_subscriber",
  "update_plan",
  "update_table_columns",
  "workspace_import_file",
  "workspace_list",
  "workspace_read",
  "workspace_search",
]);

describe("eval cases", () => {
  it("have unique ids", () => {
    const ids = EVAL_CASES.map((evalCase) => evalCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("give every tool a case, except the ones listed as not yet covered", () => {
    const covered = toolsCaseChecks();
    const missing = SOKO_BOT_CAPABILITIES.filter(
      (tool) => !covered.has(tool) && !NOT_YET_COVERED.has(tool),
    );
    // A tool in this list needs an eval case that calls it, or forbids it.
    expect(missing).toEqual([]);
  });

  it("keep the not-yet-covered list honest", () => {
    const covered = toolsCaseChecks();
    const stale = [...NOT_YET_COVERED].filter(
      (tool) =>
        covered.has(tool) ||
        !(SOKO_BOT_CAPABILITIES as readonly string[]).includes(tool),
    );
    // These have a case now, or are no tool any more: take them off the list.
    expect(stale).toEqual([]);
  });

  it("name only tools that exist", () => {
    const capabilities = new Set<string>(SOKO_BOT_CAPABILITIES);
    expect(
      [...toolsCaseChecks()].filter((tool) => !capabilities.has(tool)),
    ).toEqual([]);
  });

  it("select a suite in run order and refuse unknown ids", () => {
    const sokoBot = selectEvalCases({ suites: ["soko-bot"], caseIds: [] });
    expect(sokoBot.every((evalCase) => evalCase.suite === "soko-bot")).toBe(
      true,
    );
    expect(sokoBot[0]?.id).toBe("delegate-with-daily-checkin");
    expect(() =>
      selectEvalCases({ suites: ["soko-bot"], caseIds: ["no-such-case"] }),
    ).toThrow("Unknown eval cases: no-such-case");
  });

  it("give every Soko Bot scenario an area", () => {
    expect(
      EVAL_CASES.filter((evalCase) => evalCase.area === "Other").map(
        (evalCase) => evalCase.id,
      ),
    ).toEqual([]);
  });
});
