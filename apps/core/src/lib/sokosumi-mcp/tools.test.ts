import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOOLSETS,
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

  it("keeps everyday Task work in `tasks`", () => {
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
    expect(names("task-files")).toEqual(["tasks_files", "tasks_upload_url"]);
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

  it("marks every write that removes, merges or overwrites many contacts destructive", () => {
    const destructive = (name: string) =>
      contacts.find((tool) => tool.name === name)?.destructive;
    for (const name of [
      "contacts_merge",
      "contacts_set_stage",
      "contacts_undo_stage",
      "contacts_update_list",
      "contacts_update_list_members",
      "contacts_update_company_list_members",
      "contacts_dismiss_suggestions",
    ])
      expect(destructive(name), name).toBe(true);
  });
});
