/**
 * The schema names and the Preprod switch, and the rule that keeps the
 * Networks apart. Imports only `zod`: the deploy step loads this without
 * Core's logger or any runtime module (`scripts/check-network-layout.mts`).
 */
import { z } from "zod";

// PostgreSQL truncates identifiers past 63 bytes, so two longer names could
// be one schema. `pg_*` and `information_schema` belong to PostgreSQL.
const databaseSchemaNameSchema = z
  .string()
  .regex(/^[a-z_][a-z0-9_]*$/)
  .max(63)
  .refine((name) => !name.startsWith("pg_") && name !== "information_schema", {
    message: "Names a PostgreSQL system schema",
  })
  .default("public");

export const networkLayoutShape = {
  // Schema of the `shared` tables and of each Network's tables. All three are
  // `public` until the move splits them. They reach SQL as quoted identifiers.
  DATABASE_SCHEMA_SHARED: databaseSchemaNameSchema,
  DATABASE_SCHEMA_MAINNET: databaseSchemaNameSchema,
  DATABASE_SCHEMA_PREPROD: databaseSchemaNameSchema,
  // Preprod, the second Network in this database. Off by default; on only on
  // the split layout. It stays a switch after the move. Not the deployment's
  // `NETWORK`.
  NETWORK_PREPROD_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
};

const networkLayoutFields = z.object(networkLayoutShape);

/**
 * Two layouts are valid: every name `public` (today's), or three different
 * names, none `public` (the split). Anything between mixes the Networks'
 * tables: an unset name defaults to `public`, which holds Mainnet's tables
 * today. Preprod may be on only on the split layout. Names alone cannot tell
 * Mainnet's and Preprod's schemas swapped.
 */
export function checkNetworkLayout(
  value: z.infer<typeof networkLayoutFields>,
  context: z.RefinementCtx,
) {
  const names = [
    value.DATABASE_SCHEMA_SHARED,
    value.DATABASE_SCHEMA_MAINNET,
    value.DATABASE_SCHEMA_PREPROD,
  ];
  const split =
    new Set(names).size === names.length &&
    names.every((name) => name !== "public");
  if (!split && !names.every((name) => name === "public")) {
    context.addIssue({
      code: "custom",
      // No single variable is wrong, and a path naming one would let
      // `invalidVariables` drop the message when it quotes that value.
      path: [],
      message:
        "DATABASE_SCHEMA_SHARED, DATABASE_SCHEMA_MAINNET and DATABASE_SCHEMA_PREPROD must be all public, or all different and none public",
    });
  }
  if (value.NETWORK_PREPROD_ENABLED && !split) {
    context.addIssue({
      code: "custom",
      path: ["NETWORK_PREPROD_ENABLED"],
      message:
        "Preprod can be on only while the three DATABASE_SCHEMA_* names are all different and none is public",
    });
  }
}

/** The layout check alone, for the deploy step that runs before migrations. */
export const networkLayoutSchema =
  networkLayoutFields.superRefine(checkNetworkLayout);
