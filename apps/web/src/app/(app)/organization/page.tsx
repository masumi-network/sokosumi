import { redirect } from "next/navigation";

import { userService } from "@/lib/services";

export default async function OrganizationPage() {
  const organization = await userService.getActiveOrganization();

  if (organization) {
    redirect(`/organizations/${encodeURIComponent(organization.slug)}`);
  }

  redirect("/");
}
