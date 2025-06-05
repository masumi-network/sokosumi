import { z } from "zod";

import { FormData } from "@/lib/form";

const domainRegex =
  /^(?!:\/\/)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export function isValidDomain(domain: string): boolean {
  return domainRegex.test(domain);
}

export const editFormSchema = (
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
        z
          .string()
          .regex(domainRegex, { message: t?.("RequiredEmailDomains.invalid") }),
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

export type EditFormSchemaType = z.infer<ReturnType<typeof editFormSchema>>;

export const editFormData: FormData<
  EditFormSchemaType,
  "Components.Organizations.EditInformationModal.Form"
> = [
  {
    name: "name",
    placeholderKey: "Fields.Name.placeholder",
  },
  {
    name: "metadata",
    placeholderKey: "Fields.Metadata.placeholder",
  },
  {
    name: "requiredEmailDomains",
    labelKey: "Fields.RequiredEmailDomains.label",
    placeholderKey: "Fields.RequiredEmailDomains.placeholder",
  },
];
