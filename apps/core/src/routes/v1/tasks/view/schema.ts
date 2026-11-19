import { z } from "@hono/zod-openapi";

/** The longest saved query; the column is VARCHAR of the same size. */
export const TASK_VIEW_QUERY_MAX_LENGTH = 1000;

export const taskViewPreferenceSchema = z
  .object({
    query: z.string().nullable().openapi({
      description:
        "The Tasks page query string the person last chose in this workspace, without the leading `?`. Empty when they cleared every filter. Null when they never chose one.",
      example: "status=READY&sort=priority",
    }),
  })
  .openapi("TaskViewPreference");

export const taskViewPreferenceWriteSchema = z
  .object({
    query: z
      .string()
      .max(TASK_VIEW_QUERY_MAX_LENGTH)
      // URL-encoded query characters only: no spaces, quotes or angle brackets.
      .regex(/^[A-Za-z0-9\-._~%+=&*]*$/)
      .openapi({
        description:
          "The Tasks page query string to restore, URL-encoded, without the leading `?`. Web owns its keys.",
        example: "status=READY&sort=priority",
      }),
  })
  .openapi("TaskViewPreferenceWrite");
