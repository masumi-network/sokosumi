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

import { PersonalVendorGrantForm } from "./account-vendor-grant-actions";

export async function AccountVendorGrants() {
  const t = await getTranslations("App.Account.VendorGrants");

  let grants: VendorGrant[] = [];
  try {
    grants = await vendorGrantService.listMyVendorGrants();
  } catch (error) {
    console.error("Failed to load personal vendor grants", error);
  }

  const vendors = await vendorService.listVendors().catch(() => []);
  const groups = groupVendorGrantsByVendor(grants);

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
            mode="personal"
            emptyLabel={t("vendorsEmpty")}
            namespace="App.Account.VendorGrants"
          />
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-medium">{t("grantFormTitle")}</h3>
          <PersonalVendorGrantForm vendors={vendors} />
        </section>
      </CardContent>
    </Card>
  );
}
