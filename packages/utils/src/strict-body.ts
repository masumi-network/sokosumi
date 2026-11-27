import { z } from "zod";

/**
 * A request body that refuses keys it doesn't know, naming each one and the
 * keys it takes. Use it where a dropped key would change access, privacy or
 * stored data (SOKD-485, 489, 491): a plain object drops an unknown key and
 * the call still answers 200.
 *
 * Build it from the final shape: `.extend()` keeps the strictness but not
 * the list of keys in the message.
 */
export function strictBody<Shape extends z.ZodRawShape>(shape: Shape) {
  const takes = Object.keys(shape).join(", ");
  return z.strictObject(shape, {
    error: (issue) => {
      if (issue.code !== "unrecognized_keys") return undefined;
      const keys = issue.keys.map((key) => `"${key}"`).join(", ");
      return `Unknown ${issue.keys.length === 1 ? "key" : "keys"} ${keys}. This body takes: ${takes}.`;
    },
  });
}
