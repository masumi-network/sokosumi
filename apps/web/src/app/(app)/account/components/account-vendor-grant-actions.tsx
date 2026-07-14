"use client";

import { VendorGrantCreateForm } from "@/components/vendor-grants/vendor-grant-create-form";
import { createMyVendorGrant } from "@/lib/actions/account/vendor-grant-action";

interface PersonalVendorGrantFormProps {
  vendors: Array<{ id: string; name: string }>;
  disabledVendorIds?: string[];
}

export function PersonalVendorGrantForm({
  vendors,
  disabledVendorIds,
}: PersonalVendorGrantFormProps) {
  return (
    <VendorGrantCreateForm
      vendors={vendors}
      disabledVendorIds={disabledVendorIds}
      namespace="App.Account.VendorGrants"
      onCreate={({ vendorId, permissions }) =>
        createMyVendorGrant({ vendorId, permissions })
      }
    />
  );
}
