import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { createDataTableSchema } from "@sokosumi/utils";
import { SokoBotRuntimeValidationError } from "../soko-bot-runtime.service";

/** Only creation can resolve names from the columns declared in the same call. */
export function normalizeCreateTableInput(input: unknown) {
  const parsed = SOKO_BOT_TOOL_INPUT_SCHEMAS.create_table.parse(input);
  function columnId(reference: string): string {
    const matches = parsed.columns.filter(
      (column) => column.id === reference || column.name === reference,
    );
    if (matches.length !== 1)
      throw new SokoBotRuntimeValidationError(
        matches.length
          ? "Ambiguous column reference"
          : "Unknown column reference",
      );
    const id = matches[0].id;
    if (!id)
      throw new SokoBotRuntimeValidationError(
        "Initial row references require a stable column ID in columns",
      );
    return id;
  }
  function resolve<T>(cells: Record<string, T>): Record<string, T> {
    const resolved = new Map<string, T>();
    for (const [reference, value] of Object.entries(cells)) {
      const id = columnId(reference);
      if (resolved.has(id))
        throw new SokoBotRuntimeValidationError(
          "Duplicate references to the same column",
        );
      resolved.set(id, value);
    }
    return Object.fromEntries(resolved);
  }
  return createDataTableSchema.parse({
    ...parsed,
    rows: parsed.rows.map((row) => ({
      ...row,
      values: resolve(row.values),
      evidence: resolve(row.evidence),
    })),
  });
}
