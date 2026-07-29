"use client";

import { AlertCircle, Building2, Check, Coins, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useRef, useState } from "react";
import { toast } from "sonner";

import {
  applyConfirmationOrgProposalUpdate,
  buildConfirmationApproveOverrideIfChanged,
  buildCurrentConfirmationApproveOrganizationOverride,
  CONFIRMATION_PERSONAL_SCOPE_VALUE,
  isConfirmationOrgAwareTool,
  mergeConfirmationOrgPickerOptions,
  resolveConfirmationOrgPickerValue,
} from "@/app/personal-assistant/components/confirmation-org-picker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  approveHermesConfirmationAction,
  rejectHermesConfirmationAction,
} from "@/lib/actions/hermes";
import type {
  HermesOrganizationOption,
  HermesPendingConfirmation,
} from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

import { AssistantAvatar } from "./assistant-context";
import { SUMMARY_UUID_PATTERN } from "./confirmation-mock";
import type { ConfirmationResolution } from "./types";

function renderConfirmationSummary(
  confirmation: HermesPendingConfirmation,
): React.ReactNode {
  const { summary, referencedCoworkers, referencedOrganizations } =
    confirmation;
  if (
    referencedCoworkers.length === 0 &&
    referencedOrganizations.length === 0
  ) {
    return summary;
  }
  const coworkerById = new Map(
    referencedCoworkers.map((c) => [c.id.toLowerCase(), c]),
  );
  const orgById = new Map(
    referencedOrganizations.map((o) => [o.id.toLowerCase(), o]),
  );

  return summary.split(SUMMARY_UUID_PATTERN).map((part, index) => {
    const key = `${index}-${part}`;
    const lower = part.toLowerCase();
    const coworker = coworkerById.get(lower);
    if (coworker) {
      return <CoworkerRefChip key={key} coworker={coworker} />;
    }
    const organization = orgById.get(lower);
    if (organization) {
      return <OrgRefChip key={key} organization={organization} />;
    }
    // Unresolved chunk — either non-UUID prose or an id we couldn't
    // attribute to this user. Render verbatim.
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

function CoworkerRefChip({
  coworker,
}: {
  coworker: HermesPendingConfirmation["referencedCoworkers"][number];
}) {
  return (
    <span className="border-border/60 bg-card/80 text-foreground mx-0.5 inline-flex max-w-56 items-center gap-1.5 rounded-md border px-1.5 py-0.5 align-middle text-xs font-medium">
      {coworker.image ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={coworker.image}
          alt=""
          className="border-border size-4 shrink-0 rounded-full border"
        />
      ) : (
        <span className="bg-muted text-muted-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
          {coworker.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate">{coworker.name}</span>
    </span>
  );
}

function OrgRefChip({
  organization,
}: {
  organization: HermesPendingConfirmation["referencedOrganizations"][number];
}) {
  return (
    <span className="border-border/60 bg-card/80 text-foreground mx-0.5 inline-flex max-w-56 items-center gap-1.5 rounded-md border px-1.5 py-0.5 align-middle text-xs font-medium">
      <Building2
        className="text-muted-foreground size-3.5 shrink-0"
        aria-hidden
      />
      <span className="truncate">{organization.name}</span>
    </span>
  );
}

/**
 * Inline approve/reject card for medium-autonomy gates. Approve/reject only
 * move the card into the read-only audit trail when the orchestrator reports
 * the matching terminal status (`approved` / `rejected`). When the
 * orchestrator returns `status === "errored"` (HTTP 200), we show a toast and
 * leave the card interactive so the user can retry. `already_resolved` and
 * the opposite resolution on either action still settle the card — the gate
 * was handled elsewhere (another tab, stale list, etc.).
 */
/**
 * Tools that may spend credits. `sokosumi_create_job` always does; tasks
 * spend once a coworker actually runs against them. Either way we want
 * the user to see the "costs deduct from credits" notice before they
 * approve.
 */
const COST_BEARING_TOOLS = new Set([
  "sokosumi_create_task",
  "sokosumi_create_job",
]);

export function ConfirmationCard({
  confirmation,
  onResolved,
  organizations,
  activeOrganizationId,
  resolution,
  hasAssistantPlanCoverage = true,
  onRequireSubscription,
}: {
  confirmation: HermesPendingConfirmation;
  onResolved: (
    confirmationId: string,
    resolution: ConfirmationResolution,
    confirmation: HermesPendingConfirmation,
  ) => void;
  organizations: HermesOrganizationOption[];
  activeOrganizationId: string | null;
  /** Non-null means the user already resolved this card; render read-only. */
  resolution: ConfirmationResolution | null;
  hasAssistantPlanCoverage?: boolean;
  onRequireSubscription?: () => void;
}) {
  const t = useTranslations("App.Hermes.Running.confirmation");
  const [busy, setBusy] = useState<"approving" | "rejecting" | null>(null);

  const isResolved = resolution !== null;
  const showOrgPicker = isConfirmationOrgAwareTool(confirmation.toolName);
  const showCostNotice = COST_BEARING_TOOLS.has(confirmation.toolName);
  const orgPickerOptions = mergeConfirmationOrgPickerOptions(
    organizations,
    confirmation,
  );
  const initialOrgValue =
    resolution && resolution.organizationId !== undefined
      ? (resolution.organizationId ?? CONFIRMATION_PERSONAL_SCOPE_VALUE)
      : resolveConfirmationOrgPickerValue(
          confirmation,
          organizations,
          activeOrganizationId,
        );
  const proposedOrgValue = resolveConfirmationOrgPickerValue(
    confirmation,
    organizations,
    activeOrganizationId,
  );
  const [orgSelection, setOrgSelection] = useState(() => ({
    baselineOrgValue: initialOrgValue,
    selectedOrgValue: initialOrgValue,
    userChangedOrg: false,
  }));
  const selectedOrgRef = useRef(orgSelection.selectedOrgValue);
  selectedOrgRef.current = orgSelection.selectedOrgValue;

  if (!isResolved && showOrgPicker) {
    const syncedOrgSelection = applyConfirmationOrgProposalUpdate(
      proposedOrgValue,
      orgSelection,
    );
    if (syncedOrgSelection !== orgSelection) {
      setOrgSelection(syncedOrgSelection);
      selectedOrgRef.current = syncedOrgSelection.selectedOrgValue;
    }
  }

  const selectedOrgValue = orgSelection.selectedOrgValue;

  const handleOrgValueChange = (value: string) => {
    selectedOrgRef.current = value;
    setOrgSelection((current) => ({
      ...current,
      selectedOrgValue: value,
      userChangedOrg: true,
    }));
  };

  const handleApprove = async () => {
    if (busy || isResolved) return;
    if (!hasAssistantPlanCoverage) {
      onRequireSubscription?.();
      return;
    }
    setBusy("approving");
    // The workspace dropdown shows a local default that may NOT match the
    // workspace Hermes proposed in its tool call. Only send an organization
    // override when the user actually changes the dropdown; if they leave it
    // untouched, omit the field entirely so Hermes' proposed workspace stands.
    // Sending `organizationId` (incl. `null` for Personal) on an untouched
    // dropdown asserts a workspace choice the user never made and clobbers
    // Hermes' selection — e.g. filing a task in Personal instead of the org
    // Hermes chose. The dropdown default is reconciled with Hermes' actual
    // proposal separately (pending orchestrator-provided proposed workspace).
    // Current dropdown selection — used for the resolved-card audit display.
    const workspaceSelection = showOrgPicker
      ? buildCurrentConfirmationApproveOrganizationOverride(
          selectedOrgRef,
          orgPickerOptions,
        )
      : undefined;
    // Override actually sent: only when the user changed the workspace, so an
    // untouched dropdown leaves Hermes' proposed workspace intact.
    const workspaceOverride = showOrgPicker
      ? buildConfirmationApproveOverrideIfChanged(
          selectedOrgRef.current,
          orgSelection.baselineOrgValue,
          orgPickerOptions,
        )
      : undefined;
    const result = await approveHermesConfirmationAction(
      workspaceOverride
        ? {
            confirmationId: confirmation.id,
            confirmation,
            ...workspaceOverride,
          }
        : { confirmationId: confirmation.id, confirmation },
    );
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error.message ?? t("approveFailed"));
      return;
    }
    const { status } = result.data;
    const resolutionOrgId = workspaceSelection?.organizationId;

    if (status === "errored") {
      toast.error(result.data.error ?? t("erroredAfterApproval"));
      return;
    }
    if (status === "approved") {
      toast.success(t("approvedToast"));
      onResolved(
        confirmation.id,
        {
          status: "approved",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
      return;
    }
    if (status === "already_resolved") {
      toast.info(t("alreadyResolvedToast"));
      onResolved(
        confirmation.id,
        {
          status: "already_resolved",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
      return;
    }
    if (status === "rejected") {
      toast.info(t("alreadyResolvedToast"));
      onResolved(
        confirmation.id,
        {
          status: "rejected",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
    }
  };

  const handleReject = async () => {
    if (busy || isResolved) return;
    if (!hasAssistantPlanCoverage) {
      onRequireSubscription?.();
      return;
    }
    setBusy("rejecting");
    const resolutionOrgId = showOrgPicker
      ? buildCurrentConfirmationApproveOrganizationOverride(
          selectedOrgRef,
          orgPickerOptions,
        ).organizationId
      : undefined;
    const result = await rejectHermesConfirmationAction({
      confirmationId: confirmation.id,
      confirmation,
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error.message ?? t("rejectFailed"));
      return;
    }
    const { status } = result.data;

    if (status === "errored") {
      toast.error(result.data.error ?? t("rejectFailed"));
      return;
    }
    if (status === "rejected") {
      toast.success(t("rejectedToast"));
      onResolved(
        confirmation.id,
        {
          status: "rejected",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
      return;
    }
    if (status === "already_resolved") {
      toast.info(t("alreadyResolvedToast"));
      onResolved(
        confirmation.id,
        {
          status: "already_resolved",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
      return;
    }
    if (status === "approved") {
      toast.info(t("alreadyResolvedToast"));
      onResolved(
        confirmation.id,
        {
          status: "approved",
          organizationId: resolutionOrgId,
        },
        confirmation,
      );
    }
  };

  const tool = describeConfirmationTool(confirmation.toolName, (key) => t(key));
  const summaryFragments = renderConfirmationSummary(confirmation);

  // Resolved cards: same layout, muted chrome, status pill instead of
  // buttons, dropdown locked to the user's earlier choice. Renders as a
  // read-only audit trail in the chat.
  const isApproved = resolution?.status === "approved";
  const isAlreadyResolved = resolution?.status === "already_resolved";

  return (
    <div className="flex min-h-11 w-full items-start justify-start gap-3 px-4 py-1.5">
      <AssistantAvatar accent={!isResolved} />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border px-4 py-3 backdrop-blur-sm",
          isResolved
            ? "border-border/60 bg-muted/30"
            : "border-amber-500/30 bg-amber-500/6",
        )}
      >
        <div
          className={cn(
            "inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider",
            isResolved
              ? "text-muted-foreground"
              : "text-amber-700 dark:text-amber-400",
          )}
        >
          {isResolved ? (
            isApproved || isAlreadyResolved ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <X className="size-3.5" aria-hidden />
            )
          ) : (
            <AlertCircle className="size-3.5" aria-hidden />
          )}
          <span>
            {isResolved
              ? isApproved
                ? t("approvedStatus")
                : isAlreadyResolved
                  ? t("alreadyResolvedStatus")
                  : t("rejectedStatus")
              : t("heading")}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <div
            className={cn(
              "text-sm font-semibold tracking-tight",
              isResolved ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {tool.action}
          </div>
          <p
            className={cn(
              "text-sm leading-relaxed",
              isResolved ? "text-muted-foreground" : "text-foreground/90",
            )}
          >
            {summaryFragments}
          </p>
        </div>
        {isResolved &&
        isApproved &&
        confirmation.toolName === "sokosumi_create_task" ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5 shrink-0" aria-hidden />
            <span>{t("creatingInBackground")}</span>
          </div>
        ) : null}
        {showOrgPicker ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`confirm-org-${confirmation.id}`}
              className="text-muted-foreground text-xs font-medium uppercase tracking-wider"
            >
              {t("organizationLabel")}
            </label>
            <Select
              value={selectedOrgValue}
              onValueChange={handleOrgValueChange}
              disabled={busy !== null || isResolved}
            >
              <SelectTrigger
                id={`confirm-org-${confirmation.id}`}
                size="sm"
                className="w-full max-w-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CONFIRMATION_PERSONAL_SCOPE_VALUE}>
                  {t("organizationPersonal")}
                </SelectItem>
                {orgPickerOptions.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {showCostNotice && !isResolved ? (
          <div className="border-border/60 bg-muted/30 text-muted-foreground flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs leading-relaxed">
            <Coins className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t("costNotice")}</span>
          </div>
        ) : null}
        {isResolved ? null : (
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="primary"
              className="gap-1.5"
              disabled={busy !== null}
              onClick={() => void handleApprove()}
            >
              {busy === "approving" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="size-3.5" aria-hidden />
              )}
              <span>{t("approve")}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={busy !== null}
              onClick={() => void handleReject()}
            >
              {busy === "rejecting" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <X className="size-3.5" aria-hidden />
              )}
              <span>{t("reject")}</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
/**
 * Maps a tool slug to user-facing copy for the confirmation card.
 * Hides the technical sokosumi_* prefix; falls back to the raw slug for
 * future kinds.
 */
const CONFIRMATION_TOOL_KEYS = [
  "sokosumi_create_task",
  "sokosumi_create_job",
  "sokosumi_add_task_comment",
  "sokosumi_provide_job_input",
  "sokosumi_refund_job",
] as const;

function describeConfirmationTool(
  toolName: string,
  t: (key: string) => string,
): {
  action: string;
  helper: string;
} {
  if ((CONFIRMATION_TOOL_KEYS as readonly string[]).includes(toolName)) {
    return {
      action: t(`tools.${toolName}.action`),
      helper: t(`tools.${toolName}.helper`),
    };
  }
  return { action: toolName, helper: "" };
}
