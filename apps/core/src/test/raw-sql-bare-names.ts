import ts from "@typescript/typescript6";

import tables from "../../../../packages/database/prisma/network-tables.json" with {
  type: "json",
};

/**
 * Bare table and type names in the raw SQL that `scripts/prepare-raw-sql.ts`
 * cannot hand to PostgreSQL: statements built from pieces, `Prisma.sql`
 * fragments and commands. It reads only text the type checker found at a raw
 * SQL call site, so keywords match in any case.
 *
 * A finding is a keyword that takes a table, followed by the SQL name of one
 * of our tables (`network-tables.json`) with no schema before it, or a cast to
 * a quoted type with no schema (`::"TaskStatus"`). A name in a `${…}` hole is
 * never a finding: the text ends before it.
 * What it cannot see: a table after a comma (`FROM a, b`), after `ON`, `LOCK`,
 * `ANALYZE`, `VACUUM` or `COPY`; `CAST(x AS "Type")`; a name held in a
 * variable; a schema written out by hand (it counts as qualified).
 * False findings: a common table expression named like a table. The way out
 * is an entry in `EXCEPTIONS` of the script.
 */
const names = [
  ...Object.values(tables.network),
  ...tables.networkJoinTables,
  ...Object.values(tables.shared),
];
// PostgreSQL folds a bare name to lowercase, so only an all-lowercase name
// can be written without quotes.
const unquoted = names.filter((name) => name === name.toLowerCase());
const BARE = new RegExp(
  `(?<!CREATE\\s+(?:TEMP|TEMPORARY)\\s+)\\b(?:FROM|JOIN|INTO|UPDATE|USING|TABLE|TRUNCATE|ONLY|REFERENCES)\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?(?:"(?:${names.join("|")})"|(?:${unquoted.join("|")}))(?![\\w".])|::\\s*"\\w+"(?!\\.)`,
  "gi",
);

export type SqlText = ts.StringLiteralLike | ts.TemplateExpression;

/** A string, or a function that returns one. */
function isText(node: ts.Identifier, checker: ts.TypeChecker) {
  const type = checker.getTypeAtLocation(node);
  return checker.isTypeAssignableTo(
    type.getCallSignatures()[0]?.getReturnType() ?? type,
    checker.getStringType(),
  );
}

/**
 * Every string and template in `root`. With a checker also those in the
 * string constants and string-returning functions `root` names, however deep:
 * the pieces a `*RawUnsafe` statement is built from.
 */
export function sqlTexts(root: ts.Node, checker?: ts.TypeChecker) {
  const texts = new Set<SqlText>();
  const followed = new Set<ts.Node>();
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node))
      texts.add(node);
    if (checker && ts.isIdentifier(node) && isText(node, checker)) {
      const named = checker.getSymbolAtLocation(node);
      const symbol =
        named && named.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(named)
          : named;
      for (const declaration of symbol?.declarations ?? []) {
        const body = ts.isVariableDeclaration(declaration)
          ? declaration.initializer
          : ts.isFunctionDeclaration(declaration) ||
              ts.isMethodDeclaration(declaration)
            ? declaration.body
            : undefined;
        if (!body || followed.has(body)) continue;
        followed.add(body);
        visit(body);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return texts;
}

/** The bare names in one SQL text, each with its line in the file. */
export function bareNames(text: SqlText): { line: number; name: string }[] {
  const source = text.getSourceFile();
  const parts = ts.isTemplateExpression(text)
    ? [text.head, ...text.templateSpans.map((span) => span.literal)]
    : [text];
  return parts.flatMap((part) =>
    [...part.text.matchAll(BARE)].map((match) => ({
      line:
        source.getLineAndCharacterOfPosition(part.getStart(source)).line +
        part.text.slice(0, match.index).split("\n").length,
      name: match[0].replace(/\s+/g, " "),
    })),
  );
}
