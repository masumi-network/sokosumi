import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { simulatedEvalTool } from "./eval-guard";

describe("simulatedEvalTool", () => {
  it("answers tools that reach money or people outside Sokosumi without running them", () => {
    for (const tool of [
      "hire_agent",
      "provide_job_input",
      "add_newsletter_subscriber",
      "import_newsletter_subscribers",
      "add_newsletter_subscribers_from_contacts",
      "publish_social_post",
      "create_ad_campaign",
      "update_ad_campaign",
      "edit_ad_campaign",
      "delete_ad_campaign",
      "handle_social_comment",
    ])
      expect(simulatedEvalTool(tool, {}), tool).not.toBeNull();
  });

  it("runs everything that stays inside the eval organization", () => {
    for (const tool of [
      "create_task",
      "assign_task",
      "post_chat",
      "create_social_post",
      "schedule_social_post",
      "update_memory",
      "submit_newsletter_issue",
      "upsert_contact",
    ])
      expect(simulatedEvalTool(tool, {}), tool).toBeNull();
  });

  it("says a hire was accepted, as the real one does", () => {
    expect(simulatedEvalTool("hire_agent", {})).toMatchObject({
      executed: true,
      status: "ACCEPTED",
    });
  });
});
