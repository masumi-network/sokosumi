import { describe, expect, it } from "vitest";
import {
  SOKO_BOT_CAPABILITIES,
  SOKO_BOT_DIRECT_READ_CAPABILITIES,
  type SokoBotCapability,
} from "./policy.js";
import { SOKO_BOT_SEO_WRITE_CAPABILITIES } from "./seo.js";
import {
  buildStepFocusBundles,
  isStepFocus,
  isStepFocusWriteCapability,
  STEP_FOCUS_INSPECT_CAPABILITIES,
  STEP_FOCUS_VERIFY_CAPABILITIES,
} from "./step-focus.js";

const KNOWN_WRITE_CAPABILITIES: readonly SokoBotCapability[] = [
  ...SOKO_BOT_SEO_WRITE_CAPABILITIES,
  "create_task",
  "update_task",
  "archive_task",
  "assign_task",
  "reply_to_task",
  "update_assigned_task",
  "link_tasks",
  "set_task_parent",
  "stop_following_task",
  "hire_agent",
  "provide_job_input",
  "update_memory",
  "create_schedule",
  "update_schedule",
  "manage_reminder",
  "delete_schedule",
  "save_task_schedule",
  "delete_task_schedule",
  "post_chat",
  "open_direct_chat",
  "ask_coworker",
  "send_message",
  "upload_file",
  "move_file",
  "delete_file",
  "update_emails",
  "draft_email",
  "send_email_draft",
  "save_email_attachment",
  "generate_image",
  "generate_video",
  "generate_talking_video",
  "generate_voiceover",
  "install_skill",
  "remove_skill",
  "create_table",
  "write_table_rows",
  "update_table_columns",
  "upsert_contact",
  "update_contact",
  "log_contact_interaction",
  "merge_contacts",
  "manage_contact_lists",
  "update_company",
  "bulk_update_contacts",
  "export_contacts_to_table",
  "find_people",
  "enrich_contact",
  "find_investors",
  "investor_warm_paths",
  "create_project",
  "update_project",
  "run_integration_tool",
  "run_mcp_tool",
  "create_ad_campaign",
  "update_ad_campaign",
  "edit_ad_campaign",
  "delete_ad_campaign",
  "create_social_post",
  "update_social_post",
  "update_social_posts",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
  "newsletter_draft_issue",
  "create_newsletter_issue",
  "update_newsletter_issue",
  "delete_newsletter_issue",
  "submit_newsletter_issue",
  "update_newsletter_settings",
  "add_newsletter_subscriber",
  "import_newsletter_subscribers",
  "add_newsletter_subscribers_from_contacts",
  "update_newsletter_subscriber",
  "remove_newsletter_subscriber",
  "bash",
  "workspace_write",
  "save_brand_brain",
  "save_strategy",
  "report_update",
  "write_month_pieces",
  "write_strategy",
  "handle_social_comment",
  "save_seo_suggestions",
  "save_competitor_feed",
  "start_background_run",
  "stop_background_run",
  "wait_for",
  "save_announcement",
  "publish_announcement",
];

describe("step-focus tool bundles", () => {
  it("keeps every known write/mutation/external tool out of inspect and verify", () => {
    for (const capability of KNOWN_WRITE_CAPABILITIES) {
      expect(
        STEP_FOCUS_INSPECT_CAPABILITIES.has(capability),
        `${capability} must not be in inspect`,
      ).toBe(false);
      expect(
        STEP_FOCUS_VERIFY_CAPABILITIES.has(capability),
        `${capability} must not be in verify`,
      ).toBe(false);
      expect(isStepFocusWriteCapability(capability)).toBe(true);
    }
  });

  it("accounts for every capability in SOKO_BOT_CAPABILITIES with no unintended write leaks", () => {
    const knownWrites = new Set<string>(KNOWN_WRITE_CAPABILITIES);
    const unclassifiedWrites = SOKO_BOT_CAPABILITIES.filter(
      (capability) =>
        isStepFocusWriteCapability(capability) && !knownWrites.has(capability),
    );
    expect(unclassifiedWrites).toEqual([]);
  });

  it("includes every pure direct read capability in inspect and keeps verify a subset of inspect", () => {
    for (const capability of SOKO_BOT_DIRECT_READ_CAPABILITIES) {
      if (capability === "investor_warm_paths") {
        expect(STEP_FOCUS_INSPECT_CAPABILITIES.has(capability)).toBe(false);
        expect(STEP_FOCUS_VERIFY_CAPABILITIES.has(capability)).toBe(false);
        continue;
      }
      expect(STEP_FOCUS_INSPECT_CAPABILITIES.has(capability)).toBe(true);
    }
    for (const capability of STEP_FOCUS_VERIFY_CAPABILITIES) {
      expect(STEP_FOCUS_INSPECT_CAPABILITIES.has(capability)).toBe(true);
    }
    expect(STEP_FOCUS_INSPECT_CAPABILITIES.has("update_plan")).toBe(true);
    expect(STEP_FOCUS_VERIFY_CAPABILITIES.has("update_plan")).toBe(true);
    expect(STEP_FOCUS_INSPECT_CAPABILITIES.has("read_skill")).toBe(true);
    expect(STEP_FOCUS_VERIFY_CAPABILITIES.has("web_search")).toBe(false);
    expect(STEP_FOCUS_VERIFY_CAPABILITIES.has("run_subagent")).toBe(false);
  });

  it("never widens grants even when skillsOnDemand offers a wider tool set", () => {
    const offered: SokoBotCapability[] = [
      "list_tasks",
      "read_file",
      "web_search",
      "create_task",
      "create_social_post",
      "update_plan",
    ];
    const granted: SokoBotCapability[] = ["list_tasks", "read_file"];

    const bundles = buildStepFocusBundles(offered, granted);

    expect(bundles.callable).toEqual(["list_tasks", "read_file"]);
    expect(bundles.inspect).toEqual(["list_tasks", "read_file"]);
    expect(bundles.verify).toEqual(["list_tasks", "read_file"]);
    expect(bundles.act).toEqual([]);
    expect(bundles.answer).toEqual([]);
    expect(bundles.writeCount).toBe(0);
  });

  it("populates act with callable writes plus reads and answer with zero tools", () => {
    const offered: SokoBotCapability[] = [
      "list_tasks",
      "web_search",
      "create_task",
      "update_plan",
      "publish_social_post",
    ];
    const granted: SokoBotCapability[] = [
      "list_tasks",
      "web_search",
      "create_task",
      "update_plan",
    ];

    const bundles = buildStepFocusBundles(offered, granted);

    expect(bundles.writeCount).toBe(1);
    expect(bundles.inspect).toEqual([
      "list_tasks",
      "web_search",
      "update_plan",
    ]);
    expect(bundles.verify).toEqual(["list_tasks", "update_plan"]);
    expect(bundles.act).toEqual([
      "list_tasks",
      "web_search",
      "create_task",
      "update_plan",
    ]);
    expect(bundles.act).not.toContain("publish_social_post");
    expect(bundles.answer).toEqual([]);
  });

  it("recognizes valid step focus values", () => {
    expect(isStepFocus("inspect")).toBe(true);
    expect(isStepFocus("act")).toBe(true);
    expect(isStepFocus("verify")).toBe(true);
    expect(isStepFocus("answer")).toBe(true);
    expect(isStepFocus("implement")).toBe(false);
  });
});
