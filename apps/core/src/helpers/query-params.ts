export function preprocessMultiValueQueryInput(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  const rawValues = Array.isArray(value) ? value : [value];
  if (!rawValues.every((rawValue) => typeof rawValue === "string")) {
    return value;
  }

  return rawValues.flatMap((rawValue) =>
    rawValue.split(",").map((token) => token.trim()),
  );
}

export function deduplicateQueryValues<T extends string>(
  values: readonly T[] | undefined,
): T[] | undefined {
  if (!values) {
    return undefined;
  }

  return Array.from(new Set(values));
}
