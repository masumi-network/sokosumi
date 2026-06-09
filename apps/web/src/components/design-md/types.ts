import type { DesignMdOwnerSchemaType } from "@/lib/schemas/design-md";

export const DESIGN_MD_TRANSLATION_NAMESPACE = "App.DesignMd" as const;

export type DesignMdOwner = DesignMdOwnerSchemaType;

export interface DesignMdProfileValue {
  extractionId?: null | string;
  previewUrl?: null | string;
  url?: null | string;
}
