import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import networkTables from "../prisma/network-tables.json" with { type: "json" };

export const SQL_TABLE_NAMES_FILE = fileURLToPath(
  new URL("../src/sql-table-names.ts", import.meta.url),
);
export const GENERATE_COMMAND =
  "pnpm --filter @sokosumi/database generate:sql-table-names";

function union(name: string, doc: string, members: string[]): string {
  const lines = members.map((member) => `  | ${JSON.stringify(member)}`);
  return `/** ${doc} */\nexport type ${name} =\n${lines.join("\n")};\n`;
}

/** The literal names of `prisma/network-tables.json`, as TypeScript types. */
export function renderSqlTableNames(list: typeof networkTables): string {
  return [
    `// Generated from prisma/network-tables.json by \`${GENERATE_COMMAND}\`. Do not edit.\n`,
    union(
      "SharedTableName",
      "The SQL name of a table in the shared schema.",
      Object.values(list.shared),
    ),
    union(
      "NetworkTableName",
      "The SQL name of a table in each Network's schema.",
      [...Object.values(list.network), ...list.networkJoinTables],
    ),
    union(
      "NetworkEnumName",
      "An enum type in each Network's schema; every other enum is shared.",
      list.networkEnums,
    ),
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(SQL_TABLE_NAMES_FILE, renderSqlTableNames(networkTables));
}
