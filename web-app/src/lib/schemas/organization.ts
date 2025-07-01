import { z } from "zod";

import { isValidDomain } from "@/lib/utils";

export const updateOrganizationInformationFormSchema = (
  t?: IntlTranslation<"Components.Organizations.EditInformationModal.Schema">,
) =>
  z.object({
    name: z
      .string({ message: t?.("Name.invalid") })
      .min(1, t?.("Name.required"))
      .min(2, t?.("Name.min"))
      .max(50, t?.("Name.max")),
    metadata: z
      .string({ message: t?.("Metadata.invalid") })
      .min(10, t?.("Metadata.min"))
      .max(500, t?.("Metadata.max"))
      .or(z.literal("")),
    requiredEmailDomains: z
      .array(
        z.string().refine(isValidDomain, {
          message: t?.("RequiredEmailDomains.invalid"),
        }),
      )
      .max(10, t?.("RequiredEmailDomains.max"))
      .refine(
        (domains) =>
          new Set(domains.map((domain) => domain.toLowerCase())).size ===
          domains.length,
        {
          message: t?.("RequiredEmailDomains.unique"),
        },
      )
      .transform((domains) => domains.map((domain) => domain.toLowerCase()))
      .optional(),
  });

export type UpdateOrganizationInformationFormSchemaType = z.infer<
  ReturnType<typeof updateOrganizationInformationFormSchema>
>;

export const createOrganizationSchema = (
  t?: IntlTranslation<"Library.Auth.Schema">,
) =>
  z.object({
    name: z
      .string({ message: t?.("Organization.invalid") })
      .min(1, { message: t?.("Organization.required") })
      .min(2, { message: t?.("Organization.min") })
      .max(50, { message: t?.("Organization.max") }),
  });

export type CreateOrganizationSchemaType = z.infer<
  ReturnType<typeof createOrganizationSchema>
>;
