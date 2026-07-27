import {
  buildMetadataWithDesignMd,
  getNormalizedStringField,
  type MetadataRecord,
  parseMetadataRecord,
} from "./metadata-record.js";

/**
 * Drops client-supplied `designMdUrl` / `designMdExtractionId` from metadata.
 * Use on Better Auth create paths so only Core DESIGN.md PUT can set them.
 */
export function withoutDesignMdMetadata(
  incomingMetadata: unknown,
): MetadataRecord | null {
  return buildMetadataWithDesignMd(parseMetadataRecord(incomingMetadata), {
    url: null,
    extractionId: null,
  });
}

/**
 * Keeps server-owned DESIGN.md fields from `existingMetadata`, ignoring any
 * client-supplied `designMdUrl` / `designMdExtractionId` on the incoming write.
 * Client Better Auth metadata updates cannot invent, replace, or clear them.
 */
export function withPreservedDesignMdMetadata(
  incomingMetadata: unknown,
  existingMetadata: unknown,
): MetadataRecord | null {
  const existing = parseMetadataRecord(existingMetadata);

  return buildMetadataWithDesignMd(parseMetadataRecord(incomingMetadata), {
    url: getNormalizedStringField(existing, "designMdUrl"),
    extractionId: getNormalizedStringField(existing, "designMdExtractionId"),
  });
}
