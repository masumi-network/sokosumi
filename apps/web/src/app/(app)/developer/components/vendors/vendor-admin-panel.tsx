"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loadVendorAdminPanelAction,
  patchVendorProfileAction,
} from "@/lib/actions/vendors/vendor-admin.action";
import type { VendorMembership } from "@/lib/clients/generated/core";
import type { VendorAdminPanelData } from "@/lib/services/vendor.service";
import { VendorCoworkerAssignments } from "./vendor-coworker-assignments";
import { VendorProfileForm } from "./vendor-profile-form";

interface VendorAdminPanelProps {
  adminVendors: VendorMembership[];
}

export function VendorAdminPanel({ adminVendors }: VendorAdminPanelProps) {
  const t = useTranslations("App.Developer.Vendors");
  const [selectedVendorId, setSelectedVendorId] = useState(adminVendors[0]?.id);
  const [panelData, setPanelData] = useState<VendorAdminPanelData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingPanel, startLoadPanel] = useTransition();
  const [isSavingProfile, startSaveProfile] = useTransition();

  const selectedVendor = useMemo(
    () => adminVendors.find((vendor) => vendor.id === selectedVendorId) ?? null,
    [adminVendors, selectedVendorId],
  );

  const loadPanelData = useCallback(
    (vendorId: string) => {
      startLoadPanel(async () => {
        setLoadError(null);
        const result = await loadVendorAdminPanelAction({ vendorId });
        if (!result.ok) {
          setPanelData(null);
          setLoadError(result.error.message ?? t("loadFailed"));
          return;
        }

        setPanelData(result.data);
      });
    },
    [startLoadPanel],
  );

  useEffect(() => {
    if (!selectedVendorId) {
      setPanelData(null);
      return;
    }

    loadPanelData(selectedVendorId);
  }, [loadPanelData, selectedVendorId]);

  const handleVendorChange = useCallback((vendorId: string) => {
    setSelectedVendorId(vendorId);
  }, []);

  const handleProfileSave = useCallback(
    (values: {
      name: string;
      logos: {
        light: string | null;
        dark: string | null;
      };
    }) => {
      if (!selectedVendor || !panelData) {
        return;
      }

      startSaveProfile(async () => {
        const result = await patchVendorProfileAction({
          input: {
            vendorId: selectedVendor.id,
            name: values.name,
            logos: values.logos,
            current: {
              name: panelData.vendor.name,
              logos: panelData.vendor.logos,
            },
          },
        });

        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }

        toast.success(t("profile.saveSuccess"));
        setPanelData((current) =>
          current
            ? {
                ...current,
                vendor: {
                  ...current.vendor,
                  name: result.data.name,
                  logos: result.data.logos,
                  updatedAt: result.data.updatedAt,
                },
              }
            : current,
        );
      });
    },
    [panelData, selectedVendor, startSaveProfile, t],
  );

  const handleAssignmentsChange = useCallback(() => {
    if (!selectedVendorId) {
      return;
    }

    loadPanelData(selectedVendorId);
  }, [loadPanelData, selectedVendorId]);

  if (adminVendors.length === 0) {
    return null;
  }

  return (
    <div className="space-y-8">
      {adminVendors.length > 1 ? (
        <div className="space-y-2">
          <Label htmlFor="vendor-select">{t("vendorSelect.label")}</Label>
          <Select value={selectedVendorId} onValueChange={handleVendorChange}>
            <SelectTrigger id="vendor-select" className="w-full max-w-md">
              <SelectValue placeholder={t("vendorSelect.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {adminVendors.map((vendor) => (
                <SelectItem key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {loadError ? (
        <p className="text-destructive text-sm">{loadError}</p>
      ) : null}

      {selectedVendor && panelData ? (
        <>
          <VendorProfileForm
            key={selectedVendor.id}
            vendor={panelData.vendor}
            isSaving={isSavingProfile}
            onSave={handleProfileSave}
          />
          <VendorCoworkerAssignments
            vendorId={selectedVendor.id}
            developerMembers={panelData.developerMembers}
            coworkerAssignments={panelData.coworkerAssignments}
            isLoading={isLoadingPanel}
            onAssignmentsChange={handleAssignmentsChange}
          />
        </>
      ) : isLoadingPanel ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : null}
    </div>
  );
}
