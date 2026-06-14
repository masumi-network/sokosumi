import * as z from "zod";

/** Env-safe boolean: `z.stringbool()` plus empty/unset → default (Zod rejects `""`). */
export function publicEnvBooleanSchema(defaultValue = false) {
  return z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.stringbool().default(defaultValue),
  );
}
