import { z } from "zod";

import { FormData } from "@/lib/form";

export const inviteFormSchema = (
  t?: IntlTranslation<"Components.Organizations.InviteMemberModal.Schema">,
) =>
  z.object({
    email: z
      .email({ error: t?.("Email.invalid") })
      .min(1, { error: t?.("Email.required") }),
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
