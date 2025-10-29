import { FormData } from "@/lib/form";
import { OrganizationInformationFormSchemaType } from "@/lib/schemas";

export const organizationInformationFormData: FormData<
  OrganizationInformationFormSchemaType,
  "Components.Organizations.InformationModal.Form"
> = [
  {
    name: "name",
    placeholderKey: "Fields.Name.placeholder",
  },
];
