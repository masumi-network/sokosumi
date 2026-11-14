import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { createDataTableSchema } from "@sokosumi/utils";
import { v5 as uuidv5 } from "uuid";
import type { TableActor } from "@/helpers/data-table";
import { SokoBotRuntimeValidationError } from "../soko-bot-runtime.service";

const COLUMN_ID_PURPOSE = "soko-bot-create-table-column";

/** Only creation can resolve names from the columns declared in the same call. */
export function normalizeCreateTableInput(
  input: unknown,
  actor: Pick<TableActor, "workspaceId" | "actorId" | "actorKind">,
) {
  const parsed = SOKO_BOT_TOOL_INPUT_SCHEMAS.create_table.parse(input);
  const columns = parsed.columns.map((column) => ({ ...column }));
  const references = new Set(
    parsed.rows.flatMap((row) => [
      ...Object.keys(row.values),
      ...Object.keys(row.evidence),
    ]),
  );
  const resolvedIds = new Map<string, string>();
  for (const reference of references) {
    const matches = parsed.columns.flatMap((column, index) =>
      column.id === reference || column.name === reference ? [index] : [],
    );
    if (matches.length !== 1)
      throw new SokoBotRuntimeValidationError(
        matches.length
          ? "Ambiguous column reference"
          : "Unknown column reference",
      );
    const index = matches[0];
    const column = columns[index];
    // The ledger scopes its key to workspace and actor. Encode those fields
    // separately, so retries keep IDs and another principal cannot collide.
    // Unreferenced optional IDs stay omitted to preserve earlier request hashes.
    // Keep this encoding stable because committed operations use it on replay.
    column.id ??= uuidv5(
      JSON.stringify([
        COLUMN_ID_PURPOSE,
        actor.actorKind,
        actor.workspaceId,
        actor.actorId,
        parsed.key,
        index,
      ]),
      uuidv5.URL,
    );
    resolvedIds.set(reference, column.id);
  }
  const suppliedIds = columns.flatMap((column) =>
    column.id ? [column.id] : [],
  );
  if (new Set(suppliedIds).size !== suppliedIds.length)
    throw new SokoBotRuntimeValidationError("Column IDs must be unique");
  function resolve<T>(cells: Record<string, T>): Record<string, T> {
    const resolved = new Map<string, T>();
    for (const [reference, value] of Object.entries(cells)) {
      // Every key was resolved against the original declarations above.
      const id = resolvedIds.get(reference)!;
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
    columns,
    rows: parsed.rows.map((row) => ({
      ...row,
      values: resolve(row.values),
      evidence: resolve(row.evidence),
    })),
  });
}
