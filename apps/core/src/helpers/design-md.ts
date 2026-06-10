import {
  buildOrganizationMetadataWithDesignMd,
  buildUserMetadataWithDesignMd,
  getOrganizationMetadata,
  getUserMetadata,
  parseOrganizationMetadata,
  parseUserMetadata,
  serializeMetadataRecord,
} from "@sokosumi/utils";

export interface DesignMdWriteInput {
  url: string | null;
  extractionId: string | null;
}

export interface PersistedDesignMdRecord {
  url: string;
  extractionId: string | null;
}

interface BuiltDesignMdMetadata {
  /** Serialized metadata to persist (null clears the column). */
  serialized: string | null;
  /** Normalized stored DESIGN.md, or null when none remains after the write. */
  persisted: PersistedDesignMdRecord | null;
}

function toPersisted(
  designMdUrl: string | null,
  designMdExtractionId: string | null,
): PersistedDesignMdRecord | null {
  return designMdUrl
    ? { url: designMdUrl, extractionId: designMdExtractionId }
    : null;
}

/**
 * Merges `write` into a user's existing metadata and returns both the
 * serialized form to persist and the normalized stored DESIGN.md.
 */
export function buildUserDesignMdMetadata(
  currentMetadata: unknown,
  write: DesignMdWriteInput,
): BuiltDesignMdMetadata {
  const next = buildUserMetadataWithDesignMd(
    parseUserMetadata(currentMetadata),
    write,
  );
  const serialized = serializeMetadataRecord(next);
  const metadata = getUserMetadata(serialized);

  return {
    serialized,
    persisted: toPersisted(metadata.designMdUrl, metadata.designMdExtractionId),
  };
}

/**
 * Merges `write` into an organization's existing metadata and returns both the
 * serialized form to persist and the normalized stored DESIGN.md.
 */
export function buildOrganizationDesignMdMetadata(
  currentMetadata: unknown,
  write: DesignMdWriteInput,
): BuiltDesignMdMetadata {
  const next = buildOrganizationMetadataWithDesignMd(
    parseOrganizationMetadata(currentMetadata),
    write,
  );
  const serialized = serializeMetadataRecord(next);
  const metadata = getOrganizationMetadata(serialized);

  return {
    serialized,
    persisted: toPersisted(metadata.designMdUrl, metadata.designMdExtractionId),
  };
}
