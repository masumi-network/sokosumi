"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { CoworkerEarlyAccessForm } from "@/components/admin/coworkers/coworker-early-access-form";
import { CoworkerDisplayForm } from "@/components/coworkers/coworker-display-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  archiveAdminCoworkerAction,
  unarchiveAdminCoworkerAction,
  updateAdminCoworkerControlsAction,
  updateAdminCoworkerDisplayAction,
  updateAdminCoworkerWhitelistAction,
} from "@/lib/actions/admin-coworkers/action";
import { CommonErrorCode } from "@/lib/actions/errors";
import type {
  Coworker,
  CoworkerWorkspaceAccess,
} from "@/lib/clients/generated/core/types.gen";
import {
  ADMIN_COWORKER_CAPABILITIES,
  type AdminCoworkerCapability,
} from "@/lib/constants/coworker-display";
import type { AdminCoworkerControlsPatchBody } from "@/lib/services/admin-coworker.service";

interface CoworkerFormProps {
  coworker: Coworker;
  accessRows?: CoworkerWorkspaceAccess[];
}

function isArchived(coworker: Coworker): boolean {
  return coworker.archivedAt != null;
}

function normalizeCapabilities(
  capabilities: Coworker["capabilities"],
): AdminCoworkerCapability[] {
  return ADMIN_COWORKER_CAPABILITIES.filter((capability) =>
    capabilities.includes(capability),
  );
}

function buildControlsPatchBody(
  baseline: Coworker,
  values: {
    capabilities: AdminCoworkerCapability[];
    priority: number;
  },
): AdminCoworkerControlsPatchBody | undefined {
  const patchBody: AdminCoworkerControlsPatchBody = {};

  const nextCapabilities = [...values.capabilities].toSorted();
  const baselineCapabilities = normalizeCapabilities(
    baseline.capabilities,
  ).toSorted();
  if (nextCapabilities.join(",") !== baselineCapabilities.join(",")) {
    patchBody.capabilities = nextCapabilities;
  }

  if (values.priority !== baseline.priority) {
    patchBody.priority = values.priority;
  }

  return Object.keys(patchBody).length > 0 ? patchBody : undefined;
}

export function CoworkerForm({ coworker, accessRows = [] }: CoworkerFormProps) {
  const t = useTranslations("App.Admin.Coworkers.Form");
  const tContext = useTranslations("App.Admin.Coworkers.Context");
  const router = useRouter();

  const [baseline, setBaseline] = useState(coworker);
  const [capabilities, setCapabilities] = useState<AdminCoworkerCapability[]>(
    () => normalizeCapabilities(coworker.capabilities),
  );
  const [priority, setPriority] = useState(String(coworker.priority));
  const [isWhitelisted, setIsWhitelisted] = useState(coworker.isWhitelisted);
  const [isSavingControls, setIsSavingControls] = useState(false);
  const [isUpdatingWhitelist, setIsUpdatingWhitelist] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isUnarchiving, setIsUnarchiving] = useState(false);
  const [isDisplayBusy, setIsDisplayBusy] = useState(false);

  const archived = isArchived(baseline);
  const isBusy =
    isSavingControls ||
    isUpdatingWhitelist ||
    isArchiving ||
    isUnarchiving ||
    isDisplayBusy;

  function applySavedCoworker(saved: Coworker) {
    setBaseline(saved);
    setCapabilities(normalizeCapabilities(saved.capabilities));
    setPriority(String(saved.priority));
    setIsWhitelisted(saved.isWhitelisted);
  }

  function handleNotFound() {
    toast.error(t("errors.notFound"));
    router.push("/admin/coworkers");
  }

  function handleCapabilityChange(
    capability: AdminCoworkerCapability,
    checked: boolean,
  ) {
    setCapabilities((current) => {
      if (checked) {
        return current.includes(capability)
          ? current
          : [...current, capability];
      }
      return current.filter((value) => value !== capability);
    });
  }

  async function handleWhitelistChange(checked: boolean) {
    if (isBusy) {
      return;
    }

    const previousValue = isWhitelisted;
    setIsWhitelisted(checked);
    setIsUpdatingWhitelist(true);
    try {
      const result = await updateAdminCoworkerWhitelistAction({
        id: baseline.id,
        isWhitelisted: checked,
      });

      if (!result.ok) {
        setIsWhitelisted(previousValue);
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }
        toast.error(result.error.message ?? t("errors.whitelistSaveFailed"));
        return;
      }

      applySavedCoworker(result.value.coworker);
      toast.success(t("success.whitelistSaved"));
      router.refresh();
    } finally {
      setIsUpdatingWhitelist(false);
    }
  }

  async function handleArchive() {
    if (isBusy || archived) {
      return;
    }

    setIsArchiving(true);
    try {
      const result = await archiveAdminCoworkerAction({ id: baseline.id });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }
        toast.error(result.error.message ?? t("errors.archiveFailed"));
        return;
      }

      applySavedCoworker(result.value.coworker);
      toast.success(t("success.archived"));
      router.refresh();
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleUnarchive() {
    if (isBusy || !archived) {
      return;
    }

    setIsUnarchiving(true);
    try {
      const result = await unarchiveAdminCoworkerAction({ id: baseline.id });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }
        toast.error(result.error.message ?? t("errors.unarchiveFailed"));
        return;
      }

      applySavedCoworker(result.value.coworker);
      toast.success(t("success.unarchived"));
      router.refresh();
    } finally {
      setIsUnarchiving(false);
    }
  }

  async function handleControlsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) {
      return;
    }

    const trimmedPriority = priority.trim();
    if (!/^-?\d+$/.test(trimmedPriority)) {
      toast.error(t("validation.priorityInteger"));
      return;
    }
    const parsedPriority = Number.parseInt(trimmedPriority, 10);

    const patchBody = buildControlsPatchBody(baseline, {
      capabilities,
      priority: parsedPriority,
    });

    if (!patchBody) {
      toast.error(t("validation.noControlChanges"));
      return;
    }

    setIsSavingControls(true);
    try {
      const result = await updateAdminCoworkerControlsAction({
        id: baseline.id,
        ...patchBody,
      });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }
        toast.error(result.error.message ?? t("errors.controlsSaveFailed"));
        return;
      }

      applySavedCoworker(result.value.coworker);
      toast.success(t("success.controlsSaved"));
      router.refresh();
    } finally {
      setIsSavingControls(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{tContext("title")}</CardTitle>
          <CardDescription>{tContext("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{tContext("id")}</dt>
              <dd className="mt-1 font-mono text-xs break-all">
                {baseline.id}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{tContext("slug")}</dt>
              <dd className="mt-1">{baseline.slug}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{tContext("vendor")}</dt>
              <dd className="mt-1">{baseline.vendor.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{tContext("status")}</dt>
              <dd className="mt-2">
                {archived ? (
                  <Badge variant="secondary">{tContext("archived")}</Badge>
                ) : (
                  <Badge variant="outline">{tContext("active")}</Badge>
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("controls.title")}</CardTitle>
          <CardDescription>{t("controls.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={handleControlsSubmit}>
            <div className="space-y-3">
              <Label>{t("controls.capabilities.label")}</Label>
              <div className="flex flex-wrap gap-4">
                {ADMIN_COWORKER_CAPABILITIES.map((capability) => (
                  <label
                    key={capability}
                    className="flex items-center gap-2 text-sm"
                    htmlFor={`capability-${capability}`}
                  >
                    <Checkbox
                      id={`capability-${capability}`}
                      checked={capabilities.includes(capability)}
                      disabled={isBusy}
                      onCheckedChange={(checked) =>
                        handleCapabilityChange(capability, checked === true)
                      }
                    />
                    {t(`controls.capabilities.${capability}`)}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="coworker-priority">
                {t("controls.priority.label")}
              </Label>
              <Input
                id="coworker-priority"
                type="number"
                inputMode="numeric"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                disabled={isBusy}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="coworker-whitelist">
                  {t("controls.whitelist.label")}
                </Label>
                <p className="text-muted-foreground text-sm">
                  {t("controls.whitelist.description")}
                </p>
              </div>
              <Switch
                id="coworker-whitelist"
                checked={isWhitelisted}
                disabled={isBusy}
                onCheckedChange={handleWhitelistChange}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isBusy}>
                {isSavingControls ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t("controls.saving")}
                  </>
                ) : (
                  t("controls.save")
                )}
              </Button>

              {archived ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isBusy}
                  onClick={handleUnarchive}
                >
                  {isUnarchiving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {t("controls.unarchiving")}
                    </>
                  ) : (
                    t("controls.unarchive")
                  )}
                </Button>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={isBusy}
                    >
                      {t("controls.archive")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("controls.archiveConfirmTitle")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("controls.archiveConfirmDescription")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isArchiving}>
                        {t("cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleArchive}
                        disabled={isArchiving}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isArchiving ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            {t("controls.archiving")}
                          </>
                        ) : (
                          t("controls.archive")
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <CoworkerEarlyAccessForm
        coworkerId={baseline.id}
        accessRows={accessRows}
        disabled={isBusy}
      />

      <CoworkerDisplayForm
        coworker={baseline}
        cancelHref="/admin/coworkers"
        disabled={isBusy}
        onBusyChange={setIsDisplayBusy}
        updateAction={updateAdminCoworkerDisplayAction}
        onNotFound={handleNotFound}
      />
    </div>
  );
}
