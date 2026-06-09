import {
  buildMetadataWithDesignMd,
  buildMetadataWithUrl,
  getNormalizedStringField,
  type MetadataRecord,
  parseMetadataRecord,
} from "./metadata-record.js";

interface UserMetadataRecord extends MetadataRecord {}

export interface UserMetadata {
  designMdExtractionId: null | string;
  designMdUrl: null | string;
  url: null | string;
}

export function parseUserMetadata(
  metadata: unknown,
): UserMetadataRecord | null {
  return parseMetadataRecord(metadata);
}

export function getUserMetadata(metadata: unknown): UserMetadata {
  const parsedMetadata = parseUserMetadata(metadata);

  return {
    designMdExtractionId: getNormalizedStringField(
      parsedMetadata,
      "designMdExtractionId",
    ),
    designMdUrl: getNormalizedStringField(parsedMetadata, "designMdUrl"),
    url: getNormalizedStringField(parsedMetadata, "url"),
  };
}

export function buildUserMetadataWithUrl(
  metadata: UserMetadataRecord | null | undefined,
  rawUrl: string | null | undefined,
): UserMetadataRecord | null {
  return buildMetadataWithUrl(metadata, rawUrl);
}

export function buildUserMetadataWithDesignMd(
  metadata: UserMetadataRecord | null | undefined,
  designMd: {
    extractionId?: null | string;
    url?: null | string;
  },
): UserMetadataRecord | null {
  return buildMetadataWithDesignMd(metadata, designMd);
}
