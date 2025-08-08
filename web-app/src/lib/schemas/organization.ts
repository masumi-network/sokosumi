import { z } from "zod";

export const organizationInformationFormSchema = (
  t?: IntlTranslation<"Components.Organizations.InformationModal.Schema">,
) =>
  z.object({
    name: z
      .string({ message: t?.("Name.invalid") })
      .min(1, t?.("Name.required"))
      .min(2, t?.("Name.min"))
      .max(50, t?.("Name.max")),
  });

export type OrganizationInformationFormSchemaType = z.infer<
  ReturnType<typeof organizationInformationFormSchema>
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

export const removeOrganizationSchema = (
  t?: IntlTranslation<"Components.Organizations.RemoveModal.Schema">,
) =>
  z
    .object({
      name: z
        .string({ message: t?.("Organization.invalid") })
        .min(1, { message: t?.("Organization.required") })
        .min(2, { message: t?.("Organization.min") })
        .max(50, { message: t?.("Organization.max") }),
      confirmName: z
        .string({ message: t?.("ConfirmOrganization.invalid") })
        .min(1, { message: t?.("ConfirmOrganization.required") }),
    })
    .refine(({ name, confirmName }) => name === confirmName, {
      path: ["confirmName"],
      message: t?.("ConfirmOrganization.mismatch"),
    });

export type RemoveOrganizationSchemaType = z.infer<
  ReturnType<typeof removeOrganizationSchema>
>;
