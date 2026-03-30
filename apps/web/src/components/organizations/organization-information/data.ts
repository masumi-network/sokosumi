import type { FormData } from "@/lib/form";
import type { OrganizationInformationFormSchemaType } from "@/lib/schemas";

export const organizationInformationFormData: FormData<
  OrganizationInformationFormSchemaType,
  "Components.Organizations.InformationModal.Form"
> = [
  {
    name: "name",
    labelKey: "Fields.Name.label",
    placeholderKey: "Fields.Name.placeholder",
  },
  {
    name: "url",
    labelKey: "Fields.Url.label",
    placeholderKey: "Fields.Url.placeholder",
    type: "url",
  },
];
