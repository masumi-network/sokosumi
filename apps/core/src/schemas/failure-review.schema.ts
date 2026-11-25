import { z } from "@hono/zod-openapi";

const failureGroupSchema = z
  .object({
    key: z
      .string()
      .describe(
        "Stable cause: the parts that make the failure one class, joined by ' · '. Texts are first lines with quotes, URLs, emails, ids and numbers removed.",
      ),
    count: z.number().int().describe("Rows in the window"),
    previousCount: z
      .number()
      .int()
      .describe("Rows in the window of the same length before it"),
    examples: z
      .array(
        z.object({
          id: z.string(),
          at: z.string(),
          refs: z
            .record(z.string(), z.string())
            .describe("Ids that lead to the row's context"),
        }),
      )
      .describe("The newest rows of this cause, at most three"),
  })
  .openapi("FailureReviewGroup");

const groupsSchema = z.array(failureGroupSchema);

export const failureReviewSchema = z
  .object({
    window: z.object({
      since: z.string(),
      until: z.string(),
      previousSince: z.string(),
    }),
    sections: z.object({
      turns: groupsSchema.describe(
        "Soko Bot and Cuso turns that failed, were cancelled, or outlived their deadline still running (ORPHANED), by status, kind, version, error",
      ),
      mentions: groupsSchema.describe("Chat mentions that failed"),
      replyChecks: groupsSchema.describe(
        "Replies held back because the claim check could not run, and CLARIFY reroutes with Jev's wanted route",
      ),
      toolCalls: groupsSchema.describe("Tool calls that failed, by capability"),
      posting: groupsSchema.describe(
        "Publish attempts that did not succeed, and posts that ended FAILED or MISSED",
      ),
      media: groupsSchema.describe("Image and video jobs that failed"),
      schedules: groupsSchema.describe(
        "Schedule runs that failed, and schedules a bot disabled or deleted",
      ),
      evals: groupsSchema.describe(
        "Eval cases that failed or errored in runs of the window",
      ),
    }),
    cmoMonths: z
      .array(
        z.object({
          sokoBotId: z.string(),
          projectId: z.string(),
          projectName: z.string(),
          state: z.string(),
          ready: z.number().int(),
          total: z.number().int(),
          withoutPicture: z.number().int(),
          failedMedia: z.number().int(),
          retryAt: z.string().nullable(),
        }),
      )
      .describe(
        "Live Cusos whose approved month is stuck, blocked, unreadable or has failed pictures now",
      ),
    notCovered: z
      .array(z.string())
      .describe("Failures this report cannot see, and where they are"),
  })
  .openapi("FailureReview");
