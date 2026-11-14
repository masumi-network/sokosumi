import { z } from "zod";

const creationInput = z.object({ rows: z.array(z.unknown()).optional() });
const creationResult = z
  .object({ table: z.object({ id: z.string().min(1) }).passthrough() })
  .passthrough();

/** A successful create_table already inserted its initial rows. */
export function tableCreationFeedback(
  input: unknown,
  result: unknown,
): unknown {
  const body = creationInput.safeParse(input);
  const created = creationResult.safeParse(result);
  if (!body.success || !created.success) return result;
  const initialRowCount = body.data.rows?.length ?? 0;
  return {
    ...created.data,
    initialRowCount,
    instruction: `Table created with ${initialRowCount} initial rows already inserted. Present its link now. Do not insert those rows again. Query the table before adding further rows; patch existing rows when correcting them.`,
  };
}
