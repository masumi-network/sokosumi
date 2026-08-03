import type {
  DesignMdOwnerSchemaType,
  ManageableDesignMdOwnerSchemaType,
} from "@/lib/schemas/design-md";

export const DESIGN_MD_TRANSLATION_NAMESPACE = "App.DesignMd" as const;

/** Any DESIGN.md owner, including ad hoc — for generation (`useDesignMdGeneration`,
 * `DesignMdGenerateDialog`), which ad hoc task attachments also drive. */
export type DesignMdOwner = DesignMdOwnerSchemaType;

/** A real, persistable owner — for the profile/upload/editor surfaces that
 * write to a user's or organization's own DESIGN.md and never operate ad hoc. */
export type ManageableDesignMdOwner = ManageableDesignMdOwnerSchemaType;

export interface DesignMdProfileValue {
  extractionId?: null | string;
  previewUrl?: null | string;
  url?: null | string;
}
