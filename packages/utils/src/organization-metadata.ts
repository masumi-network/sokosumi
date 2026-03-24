interface OrganizationMetadataRecord {
  [key: string]: unknown;
}

export interface OrganizationMetadata {
  invoiceEmail: null | string;
  url: null | string;
}

export function parseOrganizationMetadata(
  metadata: unknown,
): OrganizationMetadataRecord | null {
  if (!metadata) {
    return null;
  }

  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as OrganizationMetadataRecord;
  }

  if (typeof metadata !== "string") {
    return null;
  }

  const trimmedMetadata = metadata.trim();
  if (!trimmedMetadata) {
    return null;
  }

  try {
    const parsedMetadata = JSON.parse(trimmedMetadata) as unknown;
    if (
      parsedMetadata &&
      typeof parsedMetadata === "object" &&
      !Array.isArray(parsedMetadata)
    ) {
      return parsedMetadata as OrganizationMetadataRecord;
    }

    return null;
  } catch {
    return null;
  }
}

function getNormalizedStringMetadataValue(
  metadata: OrganizationMetadataRecord | null,
  key: keyof OrganizationMetadata,
): string | null {
  if (!metadata) {
    return null;
  }

  const fieldValue = metadata[key];
  if (typeof fieldValue !== "string") {
    return null;
  }

  const normalizedValue = fieldValue.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function getOrganizationMetadata(
  metadata: unknown,
): OrganizationMetadata {
  const parsedMetadata = parseOrganizationMetadata(metadata);

  return {
    invoiceEmail: getNormalizedStringMetadataValue(
      parsedMetadata,
      "invoiceEmail",
    ),
    url: getNormalizedStringMetadataValue(parsedMetadata, "url"),
  };
}
