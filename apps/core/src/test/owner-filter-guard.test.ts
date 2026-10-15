import { fileURLToPath } from "node:url";

import { type Node, SyntaxKind } from "typescript/unstable/ast";
import {
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
} from "typescript/unstable/ast/is";
import {
  API,
  type Project,
  type Type,
  TypeFlags,
} from "typescript/unstable/sync";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Does Core ever filter by the Owner with a value that may be null or
 * undefined?
 *
 * Prisma reads `where: { ownerId: null }` as "has no Owner", which is every
 * public Task, Task Schedule and Job once public work has none (ADR 0056),
 * and it drops `where: { ownerId: undefined }` altogether, which matches
 * every row. Either turns "work this person owns" into "everyone's work"
 * without an error. A person's id that can be missing, such as the
 * Requester of a Soko Bot turn, must not reach an Owner filter.
 *
 * The check asks the TypeScript checker for the type of every value given to
 * an `ownerId` filter in Core's source: the `ownerId` of an object inside a
 * `where`, or of an object typed as a Task, Task Schedule or Job filter, and
 * the `equals` and `not` it nests. A type that admits null, undefined, any or
 * unknown fails. Raw SQL is not checked: `"ownerId" = NULL` matches no row.
 */

const CORE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_ROOT = `${CORE_ROOT}src/`;
const FIXTURE = `${SOURCE_ROOT}test/nullable-owner-filter.fixture.ts`;

const WORK_FILTER_TYPE = /\b(?:Task|TaskSchedule|Job)Where(?:Unique)?Input\b/;
const NULLISH =
  TypeFlags.Null |
  TypeFlags.Undefined |
  TypeFlags.Void |
  TypeFlags.Any |
  TypeFlags.Unknown;

const SCOPE_BOUNDARIES = new Set<SyntaxKind>([
  SyntaxKind.SourceFile,
  SyntaxKind.ArrowFunction,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
]);

interface OwnerFilterValue {
  file: string;
  line: number;
  value: Node;
}

let api: API;
let project: Project;

function isNamed(node: Node, name: string): boolean {
  return (
    (isPropertyAssignment(node) || isShorthandPropertyAssignment(node)) &&
    isIdentifier(node.name) &&
    node.name.text === name
  );
}

/** An object literal under a `where` key, up to the enclosing function. */
function isInsideWhere(node: Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (SCOPE_BOUNDARIES.has(parent.kind)) {
      return false;
    }
    if (isNamed(parent, "where")) {
      return true;
    }
  }
  return false;
}

function isWorkFilter(objectLiteral: Node): boolean {
  if (!isObjectLiteralExpression(objectLiteral)) {
    return false;
  }
  if (isInsideWhere(objectLiteral)) {
    return true;
  }
  const contextual = project.checker.getContextualType(objectLiteral);
  return (
    contextual !== undefined &&
    WORK_FILTER_TYPE.test(project.checker.typeToString(contextual))
  );
}

/** The values an `ownerId` property filters by: itself, or its `equals`/`not`. */
function filteredValues(property: Node): Node[] {
  if (isShorthandPropertyAssignment(property)) {
    return [property.name];
  }
  if (!isPropertyAssignment(property)) {
    return [];
  }
  const value = property.initializer;
  if (!isObjectLiteralExpression(value)) {
    return [value];
  }
  return value.properties
    .filter((nested) => isNamed(nested, "equals") || isNamed(nested, "not"))
    .flatMap((nested) => filteredValues(nested));
}

function ownerFilterValues(fileName: string): OwnerFilterValue[] {
  const sourceFile = project.program.getSourceFile(fileName);
  if (!sourceFile) {
    throw new Error(`${fileName} is not part of the Core project`);
  }
  const found: OwnerFilterValue[] = [];
  const visit = (node: Node) => {
    if (isNamed(node, "ownerId") && isWorkFilter(node.parent)) {
      const leading = sourceFile.text.slice(node.pos, node.end);
      const start = node.pos + leading.length - leading.trimStart().length;
      const line = sourceFile.text.slice(0, start).split("\n").length;
      for (const value of filteredValues(node)) {
        found.push({ file: fileName, line, value });
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}

function mayBeMissing(type: Type | undefined): boolean {
  if (!type) {
    return true;
  }
  if (type.isUnionType()) {
    return type.getTypes().some(mayBeMissing);
  }
  return (type.flags & NULLISH) !== 0;
}

/** `file:line (type)` for every Owner filter whose value may be missing. */
function nullableOwnerFilters(fileNames: readonly string[]): string[] {
  const values = fileNames.flatMap(ownerFilterValues);
  const types = project.checker.getTypeAtLocation(
    values.map(({ value }) => value),
  );
  return values.flatMap(({ file, line }, index) => {
    const type = types[index];
    if (!mayBeMissing(type)) {
      return [];
    }
    const shown = type ? project.checker.typeToString(type) : "unknown";
    return [`${file.slice(SOURCE_ROOT.length)}:${line} (${shown})`];
  });
}

describe("Owner filters", { timeout: 180_000 }, () => {
  beforeAll(() => {
    api = new API({ cwd: CORE_ROOT });
    const snapshot = api.updateSnapshot({
      openProjects: [`${CORE_ROOT}tsconfig.json`],
    });
    const [opened] = snapshot.getProjects();
    if (!opened) {
      throw new Error("The Core TypeScript project did not open");
    }
    project = opened;
  }, 180_000);

  afterAll(() => {
    api?.close();
  });

  it("rejects a filter fed from a value that may be null or undefined", () => {
    expect(nullableOwnerFilters([FIXTURE])).toEqual([
      "test/nullable-owner-filter.fixture.ts:16 (string | undefined)",
      "test/nullable-owner-filter.fixture.ts:22 (string | null)",
      "test/nullable-owner-filter.fixture.ts:26 (string | undefined)",
      "test/nullable-owner-filter.fixture.ts:32 (string | undefined)",
    ]);
  });

  it("finds none in Core's source", () => {
    const sourceFiles = project.program
      .getSourceFileNames()
      .filter(
        (fileName) =>
          fileName.startsWith(SOURCE_ROOT) &&
          !fileName.endsWith(".test.ts") &&
          fileName !== FIXTURE,
      );

    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(nullableOwnerFilters(sourceFiles)).toEqual([]);
  });
});
