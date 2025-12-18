import type {
  InputDataEnvelope,
  InputEnvelope,
  InputGroupsEnvelope,
  InputSchemaType,
} from "@sokosumi/masumi/schemas";

export function isGroupedSchema(
  envelope: InputEnvelope,
): envelope is InputGroupsEnvelope {
  return "input_groups" in envelope && Array.isArray(envelope.input_groups);
}

export function flattenInputs(envelope: InputEnvelope): InputSchemaType[] {
  if (isGroupedSchema(envelope)) {
    return envelope.input_groups.flatMap((group) => group.input_data);
  }
  return envelope.input_data;
}

export function getGroupFieldIds(
  envelope: InputEnvelope,
  groupIndex: number,
): string[] {
  if (!isGroupedSchema(envelope)) {
    return [];
  }
  const group = envelope.input_groups[groupIndex];
  if (!group) {
    return [];
  }
  return group.input_data.map((input) => input.id);
}

export function parseInputSchema(raw: string | null): InputEnvelope | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      if ("input_data" in parsed && Array.isArray(parsed.input_data)) {
        return { input_data: parsed.input_data } as InputDataEnvelope;
      }
      if ("input_groups" in parsed && Array.isArray(parsed.input_groups)) {
        return { input_groups: parsed.input_groups } as InputGroupsEnvelope;
      }
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      const firstItem = parsed[0];
      if (
        typeof firstItem === "object" &&
        "id" in firstItem &&
        "title" in firstItem &&
        "input_data" in firstItem
      ) {
        return { input_groups: parsed } as InputGroupsEnvelope;
      }

      return { input_data: parsed } as InputDataEnvelope;
    }

    if (Array.isArray(parsed) && parsed.length === 0) {
      return { input_data: [] } as InputDataEnvelope;
    }

    return null;
  } catch {
    return null;
  }
}
