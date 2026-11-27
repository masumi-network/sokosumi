import { describe, expect, it, vi } from "vitest";

const { coworkerCount } = vi.hoisted(() => ({ coworkerCount: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  default: { coworker: { count: coworkerCount } },
}));

import {
  evalCoworkerRefusal,
  evalPaidMediaRefusal,
  simulatedEvalTool,
} from "./eval-guard";

describe("evalPaidMediaRefusal", () => {
  it("refuses paid media that has no stub, and nothing else", () => {
    for (const tool of ["generate_talking_video", "generate_voiceover"]) {
      expect(evalPaidMediaRefusal(tool), tool).toMatch(/benchmark lane/);
      expect(simulatedEvalTool(tool, {}), tool).toBeNull();
    }
    for (const tool of ["generate_image", "generate_video", "create_task"])
      expect(evalPaidMediaRefusal(tool), tool).toBeNull();
  });
});

describe("evalCoworkerRefusal", () => {
  it("refuses a Task Schedule for a Coworker the lane was never granted", async () => {
    coworkerCount.mockResolvedValue(0);
    await expect(
      evalCoworkerRefusal("eval-ws-1", {
        name: "Daily research",
        assigneeCoworkerId: "global-paid-coworker",
        cron: "0 9 * * 1-5",
      }),
    ).resolves.toMatch(/not available in this workspace/);
    expect(coworkerCount).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { in: ["global-paid-coworker"] } }),
    });
  });
});

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
