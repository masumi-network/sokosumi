import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { VendorGrantVendorList } from "@/components/vendor-grants/vendor-grant-vendor-list";
import type { VendorGrant } from "@/lib/clients/generated/core";
import { vendorService } from "@/lib/services/vendor.service";
import { vendorGrantService } from "@/lib/services/vendor-grant.service";
import { groupVendorGrantsByVendor } from "@/lib/utils/vendor-grant-display";

import { OrganizationVendorGrantForm } from "./organization-vendor-grant-actions";

interface OrganizationVendorGrantsProps {
  organizationId: string;
}

export async function OrganizationVendorGrants({
  organizationId,
}: OrganizationVendorGrantsProps) {
  const t = await getTranslations(
    "App.Organizations.OrganizationDetail.VendorGrants",
  );

  let grants: VendorGrant[] = [];
  try {
    grants = await vendorGrantService.listVendorGrants(organizationId);
  } catch (error) {
    console.error("Failed to load vendor grants", error);
  }

  const vendors = await vendorService.listVendors().catch(() => []);
  const groups = groupVendorGrantsByVendor(grants);
  const disabledVendorIds = groups.map((group) => group.vendorId);
  const disabledVendorIdSet = new Set(disabledVendorIds);
  const hasSelectableVendor = vendors.some(
    (vendor) => !disabledVendorIdSet.has(vendor.id),
  );

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("vendorsTitle")}</h3>
          <VendorGrantVendorList
            groups={groups}
            mode="organization"
            organizationId={organizationId}
            emptyLabel={t("vendorsEmpty")}
            namespace="App.Organizations.OrganizationDetail.VendorGrants"
          />
        </section>

        {hasSelectableVendor ? (
          <section className="space-y-4">
            <h3 className="text-sm font-medium">{t("grantFormTitle")}</h3>
            <OrganizationVendorGrantForm
              organizationId={organizationId}
              vendors={vendors}
              disabledVendorIds={disabledVendorIds}
            />
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
