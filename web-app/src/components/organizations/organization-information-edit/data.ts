import { FormData } from "@/lib/form";
import { UpdateOrganizationInformationFormSchemaType } from "@/lib/schemas";

export const updateOrganizationInformationFormData: FormData<
  UpdateOrganizationInformationFormSchemaType,
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
