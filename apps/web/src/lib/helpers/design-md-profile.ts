import type { DesignMdProfileValue } from "@/components/design-md";

interface DesignMdMetadataFields {
  designMdExtractionId: null | string;
  designMdUrl: null | string;
}

export function toDesignMdProfileValue(
  metadata: DesignMdMetadataFields,
  resolvePreviewUrl: (extractionId: string) => string,
): DesignMdProfileValue | undefined {
  if (!metadata.designMdUrl) {
    return undefined;
  }

  return {
    extractionId: metadata.designMdExtractionId,
    previewUrl: metadata.designMdExtractionId
      ? resolvePreviewUrl(metadata.designMdExtractionId)
      : null,
    url: metadata.designMdUrl,
  };
}
