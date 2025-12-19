import type {
  InputFieldSchemaType,
  InputGroupSchemaType,
  InputSchemaSchemaType,
} from "@sokosumi/masumi/schemas";

interface GroupedInputSchema {
  input_groups: InputGroupSchemaType[];
}

export function isGroupedSchema(
  schema: InputSchemaSchemaType,
): schema is GroupedInputSchema {
  return "input_groups" in schema && Array.isArray(schema.input_groups);
}

export function flattenInputs(
  schema: InputSchemaSchemaType,
): InputFieldSchemaType[] {
  if (isGroupedSchema(schema)) {
    return schema.input_groups.flatMap((group) => group.input_data);
  }
  return schema.input_data;
}

export function getGroupFieldIds(
  schema: InputSchemaSchemaType,
  groupIndex: number,
): string[] {
  if (!isGroupedSchema(schema)) {
    return [];
  }
  const group = schema.input_groups[groupIndex];
  if (!group) {
    return [];
  }
  return group.input_data.map((input) => input.id);
}

export function parseInputSchema(
  raw: string | null,
): InputSchemaSchemaType | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      if ("input_data" in parsed && Array.isArray(parsed.input_data)) {
        return { input_data: parsed.input_data } as InputSchemaSchemaType;
      }
      if ("input_groups" in parsed && Array.isArray(parsed.input_groups)) {
        return { input_groups: parsed.input_groups } as InputSchemaSchemaType;
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
        return { input_groups: parsed } as InputSchemaSchemaType;
      }

      return { input_data: parsed } as InputSchemaSchemaType;
    }

    if (Array.isArray(parsed) && parsed.length === 0) {
      return { input_data: [] } as InputSchemaSchemaType;
    }

    return null;
  } catch {
    return null;
  }
}
