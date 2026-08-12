"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { patchVendorProfileAction } from "@/lib/actions/vendors/vendor-admin.action";
import type { VendorMembership } from "@/lib/clients/generated/core";

import { VendorProfileForm } from "./vendor-profile-form";

interface VendorAdminDetailProps {
  vendor: VendorMembership;
}

export function VendorAdminDetail({ vendor }: VendorAdminDetailProps) {
  const t = useTranslations("App.Developer.Vendors");
  const [currentVendor, setCurrentVendor] = useState(vendor);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const handleProfileSave = useCallback(
    async (values: {
      name: string;
      logos: {
        light: string | null;
        dark: string | null;
      };
    }) => {
      setIsSavingProfile(true);
      try {
        const result = await patchVendorProfileAction({
          input: {
            vendorId: currentVendor.id,
            name: values.name,
            logos: values.logos,
            current: {
              name: currentVendor.name,
              logos: currentVendor.logos,
            },
          },
        });

        if (!result.ok) {
          toast.error(result.error.message);
          return false;
        }

        toast.success(t("profile.saveSuccess"));
        setCurrentVendor((previous) => ({
          ...previous,
          name: result.value.name,
          logos: result.value.logos,
          updatedAt: result.value.updatedAt,
        }));
        return true;
      } finally {
        setIsSavingProfile(false);
      }
    },
    [currentVendor, t],
  );

  return (
    <VendorProfileForm
      key={`${currentVendor.id}:${String(currentVendor.updatedAt)}`}
      vendor={currentVendor}
      isSaving={isSavingProfile}
      onSave={handleProfileSave}
    />
  );
}
