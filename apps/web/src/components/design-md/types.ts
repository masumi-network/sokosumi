import type { DesignMdOwnerSchemaType } from "@/lib/schemas/design-md";

export type DesignMdOwner = DesignMdOwnerSchemaType;

export type DesignMdTranslationNamespace =
  | "App.Account.DesignMd"
  | "App.Organizations.DesignMd";

export interface DesignMdProfileValue {
  extractionId?: null | string;
  previewUrl?: null | string;
  url?: null | string;
}
