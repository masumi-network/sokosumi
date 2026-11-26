import { SAVES_FILE_TOOLS, SOKO_BOT_CAPABILITIES } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { EVAL_CASES, isJudgedEvalCase, selectEvalCases } from "./eval-cases";

/** The tools a case checks the bot calls, or does not call. */
function toolsCaseChecks(): Set<string> {
  const tools = new Set<string>();
  for (const evalCase of EVAL_CASES) {
    if (evalCase.kind === "cmo-research") tools.add("save_brand_brain");
    // A month on cmo-v6 checks that Core wrote it (write_month_pieces).
    if (evalCase.kind === "cmo-month") tools.add("write_month_pieces");
    if (evalCase.kind === "cmo-strategy") tools.add("save_strategy");
    if (evalCase.kind !== "scenario") continue;
    const { expect: wanted } = evalCase.scenario;
    for (const tool of [
      ...(wanted.tools ?? []),
      ...(wanted.anyTools ?? []),
      ...(wanted.forbiddenTools ?? []),
      ...(wanted.savesFile ? SAVES_FILE_TOOLS : []),
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
  "create_ad_campaign",
  "create_project",
  "delete_ad_campaign",
  "edit_ad_campaign",
  "enrich_contact",
  "log_contact_interaction",
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
  "get_video",
  "install_skill",
  "list_ad_accounts",
  "list_ad_campaigns",
  "list_background_runs",
  "list_contact_lists",
  "list_integration_tools",
  "list_newsletter_issues",
  "list_newsletter_subscribers",
  "list_skills",
  "list_social_account_statistics",
  "list_tables",
  "manage_reminder",
  "move_file",
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
  "write_table_rows",
  // Provider-backed SEO tools have isolated integration tests, not model cases.
  "import_seo_audit",
  "request_seo_analysis",
  "sync_seo_statistics",
]);

describe("eval cases", () => {
  it("requires real calls for the eight provider-free SEO cases", () => {
    const expected = {
      "seo-workspace-read": "get_seo_workspace",
      "seo-add-page": "add_seo_page",
      "seo-save-page-group": "save_seo_scope",
      "seo-save-keyword": "save_seo_keyword",
      "seo-confirm-competitor": "save_seo_competitor",
      "seo-recommendation-task": "create_seo_action_task",
      "seo-record-page-change": "record_seo_page_change",
      "seo-statistics-disconnected": "list_seo_statistics_properties",
    };
    for (const [id, capability] of Object.entries(expected)) {
      const found = EVAL_CASES.find((entry) => entry.id === id);
      expect(found, id).toMatchObject({ kind: "scenario", area: "SEO" });
      if (found?.kind === "scenario")
        expect(found.scenario.expect.tools, id).toContain(capability);
    }
  });

  it("freeze the site language separately from the expected language for every strategy", () => {
    const strategies = EVAL_CASES.filter(
      (evalCase) => evalCase.kind === "cmo-strategy",
    );
    expect(strategies.length).toBeGreaterThan(0);
    for (const evalCase of strategies) {
      expect(evalCase.brand.siteLanguage).toMatch(/^(English|German)$/);
      if (evalCase.brand.contentLanguage)
        expect(evalCase.brand.siteLanguage).toMatch(
          new RegExp(evalCase.brand.contentLanguage, "i"),
        );
    }
  });

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

describe("CMO chat setup", () => {
  it("seeds the change request's plan and the comment case's post", () => {
    const prepared = (id: string) => {
      const found = EVAL_CASES.find((evalCase) => evalCase.id === id);
      return found?.kind === "scenario" ? found.prepare : undefined;
    };
    expect(prepared("cmo-change-request")).toBe("cmo-plan");
    expect(prepared("cmo-change-reply-plain")).toBe("cmo-plan");
    expect(prepared("cmo-funnel-aida")).toBe("cmo-plan");
    expect(prepared("cmo-video-shapes-alsoon")).toBe("cmo-plan");
    expect(prepared("cmo-ads-yes")).toBe("cmo-plan-ads");
    expect(prepared("cmo-comment-replies")).toBe("cmo-comments");
    expect(prepared("cmo-brand-fit")).toBe("cmo-brand");
  });
});

describe("judged cases", () => {
  it("are the scenario cases a judge grades, not the check-only ones", () => {
    const byId = (id: string) => {
      const found = EVAL_CASES.find((item) => item.id === id);
      if (!found) throw new Error(`Missing case ${id}`);
      return found;
    };
    expect(isJudgedEvalCase(byId("ambiguous-request"))).toBe(true);
    const month = EVAL_CASES.find((item) => item.kind === "cmo-month");
    if (!month) throw new Error("Missing month case");
    expect(isJudgedEvalCase(month)).toBe(false);
    expect(
      EVAL_CASES.filter((item) => item.kind === "standup").every(
        (item) => !isJudgedEvalCase(item),
      ),
    ).toBe(true);
  });
});
