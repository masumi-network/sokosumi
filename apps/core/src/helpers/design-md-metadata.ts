import {
  buildOrganizationMetadataWithDesignMd,
  buildUserMetadataWithDesignMd,
  getOrganizationMetadata,
  getUserMetadata,
  parseOrganizationMetadata,
  parseUserMetadata,
  serializeMetadataRecord,
} from "@sokosumi/utils";
import { buildDesignMdPreviewUrl } from "@sokosumi/masumi/tools";

export interface DesignMdMetadata {
  extractionId: string | null;
  previewUrl: string | null;
  url: string | null;
}

function getDesignMdPreviewBaseUrl(): string | null {
  const masumiPublicUrl = process.env.MASUMI_PUBLIC_URL?.trim();
  if (masumiPublicUrl) {
    return masumiPublicUrl;
  }

  return null;
}

export function mapDesignMdMetadata(params: {
  extractionId: string | null;
  url: string | null;
}): DesignMdMetadata | null {
  if (!params.url) {
    return null;
  }

  const previewBaseUrl = getDesignMdPreviewBaseUrl();

  return {
    extractionId: params.extractionId,
    previewUrl:
      params.extractionId && previewBaseUrl
        ? buildDesignMdPreviewUrl(previewBaseUrl, params.extractionId)
        : null,
    url: params.url,
  };
}

export function readUserDesignMdMetadata(
  metadata: unknown,
): DesignMdMetadata | null {
  const parsed = getUserMetadata(metadata);
  return mapDesignMdMetadata({
    extractionId: parsed.designMdExtractionId,
    url: parsed.designMdUrl,
  });
}

export function readOrganizationDesignMdMetadata(
  metadata: unknown,
): DesignMdMetadata | null {
  const parsed = getOrganizationMetadata(metadata);
  return mapDesignMdMetadata({
    extractionId: parsed.designMdExtractionId,
    url: parsed.designMdUrl,
  });
}

export function buildUserDesignMdMetadataUpdate(
  currentMetadata: unknown,
  designMd: { extractionId?: null | string; url?: null | string },
): string | null {
  const nextMetadata = buildUserMetadataWithDesignMd(
    parseUserMetadata(currentMetadata),
    designMd,
  );

  return serializeMetadataRecord(nextMetadata);
}

export function buildOrganizationDesignMdMetadataUpdate(
  currentMetadata: unknown,
  designMd: { extractionId?: null | string; url?: null | string },
): string | null {
  const nextMetadata = buildOrganizationMetadataWithDesignMd(
    parseOrganizationMetadata(currentMetadata),
    designMd,
  );

  return serializeMetadataRecord(nextMetadata);
}
