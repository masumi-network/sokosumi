"use client";

import { VendorGrantCreateForm } from "@/components/vendor-grants/vendor-grant-create-form";
import { createOrganizationVendorGrant } from "@/lib/actions/organization";

interface OrganizationVendorGrantFormProps {
  organizationId: string;
  vendors: Array<{ id: string; name: string }>;
  disabledVendorIds?: string[];
}

export function OrganizationVendorGrantForm({
  organizationId,
  vendors,
  disabledVendorIds,
}: OrganizationVendorGrantFormProps) {
  return (
    <VendorGrantCreateForm
      vendors={vendors}
      disabledVendorIds={disabledVendorIds}
      namespace="App.Organizations.OrganizationDetail.VendorGrants"
      onCreate={({ vendorId }) =>
        createOrganizationVendorGrant({
          organizationId,
          vendorId,
        })
      }
    />
  );
}
