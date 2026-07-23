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
import { Skeleton } from "@/components/ui/skeleton";
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
    [startLoadPanel, t],
  );

  useEffect(() => {
    if (!selectedVendorId) {
      setPanelData(null);
      return;
    }

    loadPanelData(selectedVendorId);
  }, [loadPanelData, selectedVendorId]);

  const handleVendorChange = useCallback((vendorId: string) => {
    setPanelData(null);
    setLoadError(null);
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

  // Soft reloads (e.g. after assign) keep panelData; only vendor switch clears it.
  const showLoading = !panelData && !loadError;

  return (
    <div className="space-y-8">
      {adminVendors.length > 1 ? (
        <div className="space-y-2">
          <Label htmlFor="vendor-select">{t("vendorSelect.label")}</Label>
          <Select
            value={selectedVendorId}
            onValueChange={handleVendorChange}
            disabled={showLoading}
          >
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

      {showLoading ? (
        <VendorPanelLoadingView label={t("loading")} />
      ) : selectedVendor && panelData ? (
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
      ) : null}
    </div>
  );
}

function VendorPanelLoadingView({ label }: { label: string }) {
  return (
    <div
      className="space-y-8"
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-9 w-full max-w-md" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="divide-border divide-y rounded-lg border">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 px-3 py-2"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="ml-auto h-8 w-40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
