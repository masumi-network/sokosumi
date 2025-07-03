import { z } from "zod";

import { FormData } from "@/lib/form";

export const inviteFormSchema = (
  t?: IntlTranslation<"Components.Organizations.InviteMemberModal.Schema">,
) =>
  z.object({
    email: z
      .string({ message: t?.("Email.invalid") })
      .min(1, { message: t?.("Email.required") })
      .email({ message: t?.("Email.invalid") }),
  });

export type InviteFormSchemaType = z.infer<ReturnType<typeof inviteFormSchema>>;

export const inviteFormData: FormData<
  InviteFormSchemaType,
  "Components.Organizations.InviteMemberModal.Form"
> = [
  {
    name: "email",
    placeholderKey: "Fields.Email.placeholder",
  },
];
