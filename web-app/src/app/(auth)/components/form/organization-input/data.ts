import { z } from "zod";

export const createOrganizationSchema = (
  t?: IntlTranslation<"Auth.Pages.SignUp.Form.Fields.Organization.Schema.Name">,
) =>
  z.object({
    name: z
      .string({ message: t?.("invalid") })
      .min(1, t?.("required"))
      .min(2, t?.("min"))
      .max(50, t?.("max")),
  });

export type CreateOrganizationSchemaType = z.infer<
  ReturnType<typeof createOrganizationSchema>
>;
