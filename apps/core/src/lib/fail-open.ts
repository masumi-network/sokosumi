import { type CoreWarning, recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";

/**
 * The handler for a `.catch` on a step that may fail without stopping its
 * caller: it records the warning with the error's safe fields (never its
 * text, which a provider may have written), then returns the fallback.
 */
export function failOpen<T>(
  fallback: T,
  context: Record<string, unknown>,
  warning: Omit<CoreWarning, "cause" | "details">,
): (error: unknown) => T {
  return (error) => {
    recordCoreWarning(context, {
      ...warning,
      details: { failure: messageSafeErrorFields(error) },
    });
    return fallback;
  };
}
