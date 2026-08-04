import type { AbstractIntlMessages } from "next-intl";

type MessageNode = AbstractIntlMessages[string];

function getAtPath(
  messages: AbstractIntlMessages,
  parts: string[],
): MessageNode | undefined {
  let current: unknown = messages;

  for (const part of parts) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current === undefined) {
    return undefined;
  }

  return current as MessageNode;
}

function setAtPath(
  target: AbstractIntlMessages,
  parts: string[],
  value: MessageNode,
): void {
  let current: Record<string, unknown> = target;
  const lastIndex = parts.length - 1;

  for (let index = 0; index < lastIndex; index++) {
    const part = parts[index];
    if (part === undefined) {
      return;
    }

    const existing = current[part];
    if (
      typeof existing !== "object" ||
      existing === null ||
      Array.isArray(existing)
    ) {
      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
  }

  const leaf = parts[lastIndex];
  if (leaf === undefined) {
    return;
  }

  current[leaf] = value;
}

/**
 * Pick nested message subtrees by dotted paths (e.g. `App.Account`).
 * Missing paths are skipped so partial catalogs stay safe.
 */
export function pickMessages(
  messages: AbstractIntlMessages,
  paths: readonly string[],
): AbstractIntlMessages {
  const result: AbstractIntlMessages = {};

  for (const path of paths) {
    const parts = path.split(".").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    const value = getAtPath(messages, parts);
    if (value === undefined) {
      continue;
    }

    setAtPath(result, parts, value);
  }

  return result;
}
