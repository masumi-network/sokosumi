import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOOLSETS,
  isDestructive,
  MCP_TOOLS,
  MCP_TOOLSETS,
  routeGroupOf,
  selectToolsets,
  toolsetOf,
} from "./tools";

describe("selectToolsets", () => {
  it("turns on the default toolsets when the URL names none", () => {
    expect(selectToolsets(undefined)).toEqual({ toolsets: DEFAULT_TOOLSETS });
    expect(MCP_TOOLSETS).toEqual(expect.arrayContaining([...DEFAULT_TOOLSETS]));
  });

  it("reads comma-separated and repeated values, once each", () => {
    expect(selectToolsets(["tasks, jobs", "tasks", "vendors"])).toEqual({
      toolsets: ["tasks", "jobs", "vendors"],
    });
  });

  it("names an unknown toolset and lists the real ones", () => {
    expect(selectToolsets(["tasks,nope"])).toEqual({
      error: `Unknown toolset "nope". Toolsets: ${MCP_TOOLSETS.join(", ")}.`,
    });
  });

  it("refuses an empty selection", () => {
    expect(selectToolsets([" , "])).toEqual({
      error: `Name at least one toolset. Toolsets: ${MCP_TOOLSETS.join(", ")}.`,
    });
  });
});

describe("routeGroupOf", () => {
  it("is the route group the name starts with", () => {
    expect(routeGroupOf("tasks_list")).toBe("tasks");
    expect(routeGroupOf("projects_image_studio")).toBe("projects");
  });

  it("keeps a hyphenated route group whole", () => {
    expect(routeGroupOf("image_studio_catalog")).toBe("image-studio");
    expect(routeGroupOf("soko_bots_ask")).toBe("soko-bots");
  });
});

describe("toolsetOf", () => {
  it("is the route group unless the tool names a feature toolset", () => {
    expect(toolsetOf("tasks_list")).toBe("tasks");
    expect(toolsetOf("soko_bots_ask")).toBe("soko-bots");
    expect(toolsetOf("tasks_create_schedule")).toBe("task-schedules");
    expect(toolsetOf("coworkers_revoke_api_key")).toBe("coworker-access");
    expect(toolsetOf("projects_image_studio")).toBe("image-studio");
    expect(toolsetOf("projects_newsletter_issue_cancel")).toBe("newsletter");
  });
});

describe("feature toolsets", () => {
  const names = (toolset: string) =>
    MCP_TOOLS.filter((tool) => toolsetOf(tool.name) === toolset).map(
      (tool) => tool.name,
    );

  it("lists every toolset, so a misspelt one fails here", () => {
    expect([...MCP_TOOLSETS].sort()).toEqual(
      [
        "ads",
        "agents",
        "categories",
        "chats",
        "contacts",
        "coworker-access",
        "coworkers",
        "developer",
        "drive",
        "history",
        "image-studio",
        "jobs",
        "newsletter",
        "notifications",
        "organizations",
        "project-brand",
        "projects",
        "seo",
        "social",
        "soko-bots",
        "task-files",
        "task-schedules",
        "task-sharing",
        "task-views",
        "tasks",
        "transactions",
        "users",
        "vendors",
        "workspaces",
      ].sort(),
    );
  });

  it("sets `toolset` only when it differs from the route group", () => {
    for (const tool of MCP_TOOLS.filter((tool) => tool.toolset)) {
      expect(tool.toolset, tool.name).not.toBe(routeGroupOf(tool.name));
      expect(tool.toolset, tool.name).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it("keeps every toolset under the 80-tool cap", () => {
    for (const toolset of MCP_TOOLSETS) {
      expect(names(toolset).length, toolset).toBeLessThan(80);
    }
  });

  it("keeps everyday Task work in `tasks` and files in `task-files`", () => {
    expect(names("task-files")).toEqual(["tasks_files", "tasks_upload_url"]);
    expect(names("tasks")).toEqual([
      "tasks_list",
      "tasks_get",
      "tasks_create",
      "tasks_update",
      "tasks_archive",
      "tasks_events",
      "tasks_comment",
      "tasks_jobs",
      "tasks_links",
      "tasks_link",
      "tasks_unlink",
      "tasks_move",
      "tasks_receipt",
      "tasks_update_link",
      "tasks_restore",
    ]);
  });

  it("keeps Coworker set-up in `coworkers` and keys and access in `coworker-access`", () => {
    expect(names("coworkers")).toEqual([
      "coworkers_list",
      "coworkers_get",
      "coworkers_register",
      "coworkers_update",
      "coworkers_connect",
      "coworkers_archive",
      "coworkers_remove_image",
    ]);
    expect(names("coworker-access")).toEqual([
      "coworkers_list_api_keys",
      "coworkers_revoke_api_key",
      "coworkers_update_api_key",
      "coworkers_list_access",
      "coworkers_revoke_access",
    ]);
  });

  it("puts Project features in their own toolsets", () => {
    expect(names("ads")).toEqual(
      MCP_TOOLS.map((tool) => tool.name).filter((name) =>
        name.startsWith("projects_ads_"),
      ),
    );
    expect(names("social")).toEqual(
      MCP_TOOLS.map((tool) => tool.name).filter((name) =>
        name.startsWith("projects_social_"),
      ),
    );
    expect(names("image-studio")).toEqual(
      MCP_TOOLS.map((tool) => tool.name).filter(
        (name) =>
          name.startsWith("image_studio_") ||
          name.startsWith("projects_image_studio"),
      ),
    );
  });
});

describe("tools that spend credits", () => {
  it("say so first", () => {
    for (const tool of MCP_TOOLS.filter((tool) => tool.spendsCredits)) {
      expect(tool.description, tool.name).toMatch(
        /^Spends workspace credits\. /,
      );
    }
  });

  it("leave chat messages out: no cost warning or confirm step on chat", () => {
    for (const name of ["chats_send", "chats_retry_mention"]) {
      const tool = MCP_TOOLS.find((tool) => tool.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.spendsCredits, name).toBeFalsy();
      expect(tool?.description, name).not.toMatch(/credits|paid|confirm/i);
    }
  });

  it("include every Image Studio start, and not its cancel (ADR 0077)", () => {
    const spends = (operation: string) =>
      MCP_TOOLS.find((tool) => tool.operation === operation)?.spendsCredits;

    for (const kind of [
      "jobs",
      "video-jobs",
      "short-video-jobs",
      "talking-video-jobs",
    ]) {
      expect(spends(`POST /projects/{id}/image-studio/${kind}`), kind).toBe(
        true,
      );
    }
    const cancel = MCP_TOOLS.find(
      (tool) =>
        tool.operation ===
        "POST /projects/{id}/image-studio/jobs/{jobId}/cancel",
    );
    expect(cancel).toBeDefined();
    expect(cancel?.spendsCredits).toBeFalsy();
  });
});

describe("contacts toolset", () => {
  const contacts = MCP_TOOLS.filter(
    (tool) => toolsetOf(tool.name) === "contacts",
  );

  it("is off by default: contacts are personal data", () => {
    expect(contacts.length).toBeGreaterThan(0);
    expect(DEFAULT_TOOLSETS).not.toContain("contacts");
  });

  it("warns before the web lookups that spend credits", () => {
    const spending = contacts.filter((tool) => tool.spendsCredits);
    expect(spending.map((tool) => tool.name)).toEqual([
      "contacts_enrich",
      "contacts_find_people",
    ]);
    for (const tool of spending)
      expect(tool.description).toMatch(/^Spends workspace credits\./);
  });
});

/**
 * Every tool clients must confirm (`destructiveHint`) besides the credit
 * spenders. A change here is a decision: check it against `isDestructive`.
 */
const DESTRUCTIVE_TOOLS = [
  "chats_decline_invitation",
  "chats_delete_message",
  "chats_leave",
  "chats_remove_coworker",
  "chats_remove_member",
  "chats_remove_soko_bot",
  "chats_revoke_invitation",
  "contacts_delete_company_list",
  "contacts_delete_interaction",
  "contacts_delete_list",
  "contacts_dismiss_suggestions",
  "contacts_merge",
  "contacts_remove_channel",
  "contacts_update_list",
  "coworkers_archive",
  "coworkers_remove_image",
  "coworkers_revoke_access",
  "coworkers_revoke_api_key",
  "drive_close_data_room",
  "drive_create_data_room",
  "drive_delete",
  "drive_delete_collection",
  "drive_delete_folder",
  "drive_remove_data_room_member",
  "drive_set_data_room_colleagues",
  "drive_unshare",
  "drive_update_collection",
  "drive_update_label",
  "drive_update_table",
  "jobs_unshare",
  "newsletter_delete_issue",
  "newsletter_remove_sending_domain",
  "newsletter_remove_subscriber",
  "newsletter_update_subscriber",
  "organizations_deny_coworker_access",
  "organizations_deny_vendor_grant",
  "organizations_revoke_coworker_access",
  "organizations_revoke_vendor_grant",
  "organizations_set_design_md",
  "organizations_unassign_seat",
  "projects_ads_campaign_create",
  "projects_ads_campaign_edit",
  "projects_ads_campaign_update",
  "projects_ads_market_update",
  "projects_cancel_owed",
  "projects_clear_design",
  "projects_close",
  "projects_image_studio_brand_assets_update",
  "projects_image_studio_brand_kit_update",
  "projects_image_studio_brand_look_update",
  "projects_image_studio_products_update",
  "projects_set_brand_brain",
  "projects_set_design",
  "projects_social_post_cancel",
  "projects_social_queue_slots_update",
  "seo_audit_save_brief",
  "seo_audit_set_brand_terms",
  "seo_audit_update_scope",
  "seo_project_save_brief",
  "seo_project_set_brand_terms",
  "seo_project_update_scope",
  "soko_bots_archive",
  "soko_bots_delete_my_schedule",
  "soko_bots_delete_schedule",
  "soko_bots_remove_my_skill",
  "soko_bots_reset_memory",
  "soko_bots_reset_my_memory",
  "tasks_delete_schedule",
  "tasks_end_schedule",
  "users_delete_workspace",
  "users_deny_coworker_access",
  "users_deny_vendor_grant",
  "users_revoke_coworker_access",
  "users_revoke_vendor_grant",
  "users_set_design_md",
  "vendors_decline_invite",
  "vendors_logo_cleanup",
  "vendors_remove_member",
  "vendors_revoke_invite",
  "vendors_unassign",
];

describe("isDestructive", () => {
  const writes = MCP_TOOLS.filter((tool) => !tool.operation.startsWith("GET "));

  it("marks exactly the tools that take away what a person cannot get back", () => {
    expect(
      writes
        .filter((tool) => isDestructive(tool) && !tool.spendsCredits)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(DESTRUCTIVE_TOOLS);
  });

  it("never marks a read, and always marks a credit spender", () => {
    for (const tool of MCP_TOOLS)
      if (tool.operation.startsWith("GET "))
        expect(isDestructive(tool), tool.name).toBe(false);
      else if (tool.spendsCredits)
        expect(isDestructive(tool), tool.name).toBe(true);
  });

  it("marks deletes, revokes, denials and whole replacements", () => {
    for (const tool of writes)
      if (
        /^(Delete|Revoke|Deny|Erase|Replace)\b/.test(tool.description) ||
        /cannot be undone/.test(tool.description)
      )
        expect(isDestructive(tool), tool.name).toBe(true);
  });

  it("leaves plain field updates and anything with a way back unmarked", () => {
    for (const tool of writes)
      if (
        /^(Change|Rename|Edit|Mark|Move|Undo|Restore)\b/.test(
          tool.description,
        ) &&
        !tool.spendsCredits &&
        !/cannot be undone|unsubscribe|merg|drops|replace|deletes/i.test(
          tool.description,
        )
      )
        expect(isDestructive(tool), tool.name).toBe(false);
  });
});
