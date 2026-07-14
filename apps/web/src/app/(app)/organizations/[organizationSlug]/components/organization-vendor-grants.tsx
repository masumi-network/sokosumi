import { getTranslations } from "next-intl/server";

import { VendorMark } from "@/components/agents/vendor-mark";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { VendorGrant } from "@/lib/clients/generated/core";
import { vendorService } from "@/lib/services/vendor.service";
import { vendorGrantService } from "@/lib/services/vendor-grant.service";
import {
  groupPendingVendorGrants,
  type VendorGrantDisplayRow,
} from "@/lib/utils/vendor-grant-display";

import {
  OrganizationVendorGrantForm,
  VendorGrantMutationButtons,
} from "./organization-vendor-grant-actions";

interface OrganizationVendorGrantsProps {
  organizationId: string;
}

function permissionLabelKey(
  row: VendorGrantDisplayRow,
):
  | "Permissions.readAndComment"
  | `Permissions.${"taskRead" | "taskComment" | "taskCreate"}` {
  if (row.kind === "bundled") {
    return "Permissions.readAndComment";
  }

  switch (row.grant.permission) {
    case "task:read":
      return "Permissions.taskRead";
    case "task:comment":
      return "Permissions.taskComment";
    case "task:create":
      return "Permissions.taskCreate";
    default:
      return "Permissions.taskCreate";
  }
}

function activeGrantPermissionKey(
  grant: VendorGrant,
): `Permissions.${"taskRead" | "taskComment" | "taskCreate"}` {
  switch (grant.permission) {
    case "task:read":
      return "Permissions.taskRead";
    case "task:comment":
      return "Permissions.taskComment";
    case "task:create":
      return "Permissions.taskCreate";
    default:
      return "Permissions.taskCreate";
  }
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
  const pendingRows = groupPendingVendorGrants(grants);
  const activeGrants = grants.filter((grant) => grant.status === "GRANTED");

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("pendingTitle")}</h3>
            {pendingRows.length > 0 ? (
              <Badge variant="secondary">{pendingRows.length}</Badge>
            ) : null}
          </div>
          {pendingRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("pendingEmpty")}</p>
          ) : (
            <ul className="divide-border divide-y rounded-lg border">
              {pendingRows.map((row) => {
                const grantId =
                  row.kind === "bundled" ? row.primaryGrantId : row.grant.id;
                const vendorName =
                  row.kind === "bundled"
                    ? row.vendorName
                    : row.grant.vendorName;
                const vendorSlug =
                  row.kind === "bundled"
                    ? row.vendorSlug
                    : row.grant.vendorSlug;

                return (
                  <li
                    key={grantId}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <VendorMark
                          vendor={{
                            name: vendorName,
                            slug: vendorSlug,
                            logos: { light: null, dark: null },
                          }}
                          className="text-sm font-medium"
                        />
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {t(permissionLabelKey(row))}
                      </p>
                    </div>
                    <VendorGrantMutationButtons
                      organizationId={organizationId}
                      grantId={grantId}
                      variant="pending"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("activeTitle")}</h3>
          {activeGrants.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("activeEmpty")}</p>
          ) : (
            <ul className="divide-border divide-y rounded-lg border">
              {activeGrants.map((grant) => (
                <li
                  key={grant.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <VendorMark
                      vendor={{
                        name: grant.vendorName,
                        slug: grant.vendorSlug,
                        logos: { light: null, dark: null },
                      }}
                      className="text-sm font-medium"
                    />
                    <p className="text-muted-foreground text-sm">
                      {t(activeGrantPermissionKey(grant))}
                    </p>
                  </div>
                  <VendorGrantMutationButtons
                    organizationId={organizationId}
                    grantId={grant.id}
                    variant="active"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("grantFormTitle")}</h3>
          <OrganizationVendorGrantForm
            organizationId={organizationId}
            vendors={vendors}
          />
        </section>
      </CardContent>
    </Card>
  );
}
