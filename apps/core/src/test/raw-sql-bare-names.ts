import { $Enums } from "@sokosumi/database";
import ts from "@typescript/typescript6";

import tables from "../../../../packages/database/prisma/network-tables.json" with {
  type: "json",
};

/**
 * Bare table and enum type names in the raw SQL that
 * `scripts/prepare-raw-sql.ts` cannot hand to PostgreSQL: `Prisma.sql`
 * fragments, and the literal text of skipped statements and commands. A
 * finding fails CI's job `Test Core PostgreSQL split layout`. That job is not
 * a required check, so it turns red and does not block a merge.
 *
 * A finding is a keyword that takes a table, in any case, followed by the SQL
 * name of one of our tables (`network-tables.json`) with no schema before it,
 * or a cast to one of our enum types with no schema (`::"TaskStatus"`). A
 * quoted name must match exactly; a bare one matches in any case, as in
 * PostgreSQL. Comments and strings of the SQL are not read, and neither is a
 * `${…}` hole.
 *
 * False failures (waive them in `EXCEPTIONS` of the script): a common table
 * expression or a temporary table named like one of our tables; `EXTRACT`,
 * `TRIM` or `SUBSTRING(… FROM x)` where `x` is a bare column named like a
 * table; a quoted identifier that reads like a table reference
 * (`AS "from task count"`); such text after a backslash-escaped quote in an
 * `E''` string, or in a nested block comment.
 * Not seen: a name after a comma (`FROM a, b`), after `LOCK` without `TABLE`,
 * `ANALYZE`, `VACUUM`, `COPY`, `ON`, `LIKE` or `INHERIT`; `CAST(… AS "Type")`;
 * a name split across pieces or held in a variable; a fragment imported from
 * outside `SOURCE_PATHS`; all `*RawUnsafe` text built from pieces; any text
 * passed to `Prisma.raw`; a quoted name in a string with escaped quotes; a
 * name after a quoted identifier that holds `--` or an opening block comment.
 */
const names = [
  ...Object.values(tables.network),
  ...tables.networkJoinTables,
  ...Object.values(tables.shared),
];
const unquoted = names.filter((name) => name === name.toLowerCase());
const BARE = new RegExp(
  `(?i:(?<!\\b(?:temp|temporary|distinct)\\s+)\\b(?:from|join|into|update|using|table|truncate|only|references)\\s+(?:if\\s+(?:not\\s+)?exists\\s+)?)(?:"(?:${names.join("|")})"|(?i:${unquoted.join("|")}))(?![\\w$"]|\\s*\\.)|::\\s*"(?:${Object.keys($Enums).join("|")})"(?!\\s*\\.)`,
  "g",
);
/**
 * Line comments (to a line break, escaped or not), block comments,
 * single-quoted and dollar-quoted strings, and an escaped line break or tab
 * of the TypeScript source.
 */
const NOT_SQL =
  /--[^\n]*?(?=\\n|\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\$(\w*)\$[\s\S]*?\$\1\$|\\[nrt]/g;
const blank = (text: string) => text.replace(/[^\n]/g, " ");

/**
 * The bare names in one SQL text: the line of the first, and all of them as
 * the message a waiver must repeat.
 */
export function bareNames(text: ts.Node) {
  if (!ts.isStringLiteralLike(text) && !ts.isTemplateExpression(text)) return;
  const source = text.getSourceFile();
  const start = text.getStart(source) + 1;
  // The source as written, so every offset is a place in the file.
  let sql = source.text.slice(start, text.end - 1);
  for (const { expression, literal } of ts.isTemplateExpression(text)
    ? text.templateSpans
    : []) {
    const [from, to] = [
      expression.pos - start,
      literal.getStart(source) - start,
    ];
    sql = sql.slice(0, from) + blank(sql.slice(from, to)) + sql.slice(to);
  }
  sql = sql.replace(NOT_SQL, blank);
  const found = [...sql.matchAll(BARE)];
  const [first] = found;
  if (!first) return;
  return {
    line:
      source.getLineAndCharacterOfPosition(
        start + first.index + first[0].length - 1,
      ).line + 1,
    message: found.map(([match]) => match.replace(/\s+/g, " ")).join(", "),
  };
}
