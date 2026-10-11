import { PROJECT_IDENTIFIER_MAX_LENGTH } from "./project-identifier.js";

/**
 * Builds a Linear-style short id (`SOK-12`) from a project prefix and task
 * number. Null when either half is missing (no project, or unnumbered).
 */
export function formatTaskIdentifier(
  projectIdentifier: string | null | undefined,
  number: number | null | undefined,
): string | null {
  if (!projectIdentifier || number == null) {
    return null;
  }
  return `${projectIdentifier}-${number}`;
}

/** Loose UUID shape for path segments (any hex groups; version bits unchecked). */
const TASK_REF_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Trailing text after the number is a URL slug and is ignored. Prefix length
// matches PROJECT_IDENTIFIER_MAX_LENGTH (letter + up to 6 more chars).
const TASK_REF_IDENTIFIER_PATTERN = new RegExp(
  `^([A-Za-z][A-Za-z0-9]{1,${PROJECT_IDENTIFIER_MAX_LENGTH - 1}})-(\\d{1,9})(?:-.*)?$`,
);

type TaskRef =
  | { kind: "id"; id: string }
  | { kind: "identifier"; prefix: string; number: number };

/**
 * Reads a task path segment as a UUID or a project identifier such as
 * `SOK-12` or `sok-12-some-slug`. Null means neither, so callers treat the
 * raw segment as an id as before.
 */
export function parseTaskRef(ref: string): TaskRef | null {
  if (TASK_REF_UUID_PATTERN.test(ref)) {
    return { kind: "id", id: ref };
  }
  const match = TASK_REF_IDENTIFIER_PATTERN.exec(ref);
  if (!match) {
    return null;
  }
  return {
    kind: "identifier",
    prefix: match[1]!.toUpperCase(),
    number: Number(match[2]),
  };
}
