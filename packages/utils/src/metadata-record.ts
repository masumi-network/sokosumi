import { normalizeWebsiteUrl } from "./website-url.js";

export type MetadataRecord = Record<string, unknown>;

const DESIGN_MD_EXTRACTION_ID_KEY = "designMdExtractionId";
const DESIGN_MD_URL_KEY = "designMdUrl";

export function parseMetadataRecord(metadata: unknown): MetadataRecord | null {
  if (!metadata) {
    return null;
  }

  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as MetadataRecord;
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
      return parsedMetadata as MetadataRecord;
    }

    return null;
  } catch {
    return null;
  }
}

export function normalizeMetadataRecord(
  metadata: MetadataRecord | null | undefined,
): MetadataRecord {
  return metadata ?? {};
}

export function stringifyMetadataRecord(
  metadata: MetadataRecord,
): MetadataRecord | null {
  return Object.keys(metadata).length > 0 ? metadata : null;
}

export function serializeMetadataRecord(
  metadata: MetadataRecord | null | undefined,
): string | null {
  const normalizedMetadata = stringifyMetadataRecord(
    normalizeMetadataRecord(metadata),
  );

  return normalizedMetadata ? JSON.stringify(normalizedMetadata) : null;
}

export function getNormalizedStringField(
  metadata: MetadataRecord | null,
  key: string,
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

/**
 * Merges plain string fields into a metadata record. A key set to an empty
 * string or `null` is removed; `undefined` leaves the existing value alone, so
 * callers can patch one field without reading the rest.
 */
export function buildMetadataWithStringFields(
  metadata: MetadataRecord | null | undefined,
  fields: Record<string, null | string | undefined>,
): MetadataRecord | null {
  let nextMetadata = normalizeMetadataRecord(metadata);

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }

    const normalizedValue = value?.trim() ?? "";
    if (normalizedValue.length === 0) {
      const { [key]: _removed, ...rest } = nextMetadata;
      nextMetadata = rest;
      continue;
    }

    nextMetadata = { ...nextMetadata, [key]: normalizedValue };
  }

  return stringifyMetadataRecord(nextMetadata);
}

export interface DesignMdMetadataPatch {
  extractionId?: null | string;
  url?: null | string;
}

function applyDesignMdField(
  metadata: MetadataRecord,
  key: "designMdExtractionId" | "designMdUrl",
  value: null | string | undefined,
): MetadataRecord {
  if (value === undefined) {
    return metadata;
  }

  const normalizedValue = value?.trim() ?? "";
  if (normalizedValue.length === 0) {
    const { [key]: _removed, ...rest } = metadata;
    return rest;
  }

  return {
    ...metadata,
    [key]: normalizedValue,
  };
}

export function buildMetadataWithDesignMd(
  metadata: MetadataRecord | null | undefined,
  designMd: DesignMdMetadataPatch,
): MetadataRecord | null {
  let nextMetadata = normalizeMetadataRecord(metadata);

  if ("extractionId" in designMd) {
    nextMetadata = applyDesignMdField(
      nextMetadata,
      DESIGN_MD_EXTRACTION_ID_KEY,
      designMd.extractionId,
    );
  }

  if ("url" in designMd) {
    nextMetadata = applyDesignMdField(
      nextMetadata,
      DESIGN_MD_URL_KEY,
      designMd.url,
    );
  }

  return stringifyMetadataRecord(nextMetadata);
}

export function buildMetadataWithUrl(
  metadata: MetadataRecord | null | undefined,
  rawUrl: string | null | undefined,
): MetadataRecord | null {
  const metadataRecord = normalizeMetadataRecord(metadata);
  const trimmed = rawUrl?.trim() ?? "";

  if (trimmed.length === 0) {
    const { url: _url, ...metadataWithoutUrl } = metadataRecord;
    return stringifyMetadataRecord(metadataWithoutUrl);
  }

  // Only store values that pass the shared website-URL check (aligned with
  // z.httpUrl). Callers that need a validation error must check first with
  // isEmptyOrValidWebsiteUrl / normalizeWebsiteUrl.
  const websiteUrl = normalizeWebsiteUrl(trimmed);
  if (!websiteUrl) {
    const { url: _url, ...metadataWithoutUrl } = metadataRecord;
    return stringifyMetadataRecord(metadataWithoutUrl);
  }

  return {
    ...metadataRecord,
    url: websiteUrl,
  };
}
