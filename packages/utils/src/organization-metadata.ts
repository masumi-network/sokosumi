import {
  buildMetadataWithDesignMd,
  buildMetadataWithUrl,
  getNormalizedStringField,
  type MetadataRecord,
  parseMetadataRecord,
} from "./metadata-record.js";

interface OrganizationMetadataRecord extends MetadataRecord {}

export interface OrganizationMetadata {
  designMdExtractionId: null | string;
  designMdUrl: null | string;
  invoiceEmail: null | string;
  url: null | string;
}

export function parseOrganizationMetadata(
  metadata: unknown,
): OrganizationMetadataRecord | null {
  return parseMetadataRecord(metadata);
}

export function getOrganizationMetadata(
  metadata: unknown,
): OrganizationMetadata {
  const parsedMetadata = parseOrganizationMetadata(metadata);

  return {
    designMdExtractionId: getNormalizedStringField(
      parsedMetadata,
      "designMdExtractionId",
    ),
    designMdUrl: getNormalizedStringField(parsedMetadata, "designMdUrl"),
    invoiceEmail: getNormalizedStringField(parsedMetadata, "invoiceEmail"),
    url: getNormalizedStringField(parsedMetadata, "url"),
  };
}

export function buildOrganizationMetadataWithUrl(
  metadata: OrganizationMetadataRecord | null | undefined,
  rawUrl: string | null | undefined,
): OrganizationMetadataRecord | null {
  return buildMetadataWithUrl(metadata, rawUrl);
}

export function buildOrganizationMetadataWithDesignMd(
  metadata: OrganizationMetadataRecord | null | undefined,
  designMd: {
    extractionId?: null | string;
    url?: null | string;
  },
): OrganizationMetadataRecord | null {
  return buildMetadataWithDesignMd(metadata, designMd);
}
