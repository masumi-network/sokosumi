"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState, useTransition } from "react";
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
  const [isSavingProfile, startSaveProfile] = useTransition();

  const handleProfileSave = useCallback(
    (values: {
      name: string;
      logos: {
        light: string | null;
        dark: string | null;
      };
    }) => {
      startSaveProfile(async () => {
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
          return;
        }

        toast.success(t("profile.saveSuccess"));
        setCurrentVendor((previous) => ({
          ...previous,
          name: result.data.name,
          logos: result.data.logos,
          updatedAt: result.data.updatedAt,
        }));
      });
    },
    [currentVendor, startSaveProfile, t],
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
