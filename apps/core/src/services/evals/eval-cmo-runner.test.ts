import type { MarketingStrategyPlan } from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { commentChecks, monthPlanFromTomorrow } from "./eval-cmo-runner";

describe("commentChecks", () => {
  const ids = {
    price: "c-price",
    angry: "c-angry",
    spam: "c-spam",
    praise: "c-praise",
    german: "c-german",
  };
  const call = (commentId: string, action: string) => ({
    capability: "handle_social_comment",
    input: { commentId, action },
  });

  it("passes when every comment gets the action it calls for", () => {
    const checks = commentChecks(
      [
        { capability: "list_social_comments", input: {} },
        call("c-price", "reply"),
        call("c-angry", "owner"),
        call("c-spam", "skip"),
        call("c-praise", "reply"),
        call("c-german", "owner"),
      ],
      ids,
    );
    expect(checks.every((check) => check.pass)).toBe(true);
  });

  it("fails a reply to an angry customer and a comment left alone", () => {
    const checks = commentChecks(
      [call("c-angry", "reply"), call("c-spam", "skip")],
      ids,
    );
    expect(
      checks.filter((check) => !check.pass).map((check) => check.label),
    ).toEqual([
      "Handles every comment",
      "price: reply or owner",
      "angry: owner",
      "praise: reply",
      "german: reply or owner",
    ]);
  });
});

describe("monthPlanFromTomorrow", () => {
  it("moves the pieces to one a day from tomorrow and drops what production left", () => {
    const plan = {
      summary: "Plan",
      calendar: [
        {
          id: "a",
          date: "2026-10-01",
          time: "09:00",
          channel: "linkedin",
          title: "Launch",
          format: "post",
          status: "published",
          brief: "Brief",
          draft: "Old words",
          socialPostId: "00000000-0000-4000-8000-000000000001",
          imageFileId: "file-1",
        },
        {
          id: "b",
          date: "2026-10-02",
          channel: "x",
          title: "Skip me",
          format: "post",
          status: "skipped",
        },
        {
          id: "c",
          date: "2026-10-05",
          channel: "x",
          title: "Thread",
          format: "thread",
          status: "idea",
        },
      ],
    } as unknown as MarketingStrategyPlan;
    const moved = monthPlanFromTomorrow(plan, new Date("2026-11-09T04:00:00Z"));
    expect(moved.calendar).toEqual([
      {
        id: "a",
        date: "2026-11-10",
        time: "09:00",
        channel: "linkedin",
        title: "Launch",
        format: "post",
        status: "idea",
        brief: "Brief",
      },
      {
        id: "c",
        date: "2026-11-11",
        channel: "x",
        title: "Thread",
        format: "thread",
        status: "idea",
      },
    ]);
    expect(moved.summary).toBe("Plan");
  });
});
