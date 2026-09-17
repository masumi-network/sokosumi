import { validateTableValues as validateValues } from "@sokosumi/utils";
import { unprocessableEntity } from "@/helpers/error";

export function validateTableValues(
  ...args: Parameters<typeof validateValues>
): void {
  try {
    validateValues(...args);
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid table values",
    );
  }
}
