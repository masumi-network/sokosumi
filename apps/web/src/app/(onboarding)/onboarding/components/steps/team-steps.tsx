"use client";

import type { OnboardingWorkStyle } from "@sokosumi/utils";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { AlertCircle, Building2, Check, Link2, Loader2 } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canUseNextImageSrc } from "@/config/next-image";
import { cn } from "@/lib/utils";

import type { OnboardingTeamPath } from "../onboarding-steps";
import { StepShell } from "../step-shell";

interface ChoiceCardProps {
  badge?: string;
  description: string;
  isSelected: boolean;
  onSelect: () => void;
  title: string;
}

function ChoiceCard({
  badge,
  description,
  isSelected,
  onSelect,
  title,
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onSelect}
      className={cn(
        "focus-visible:ring-ring relative flex h-full flex-col items-start gap-3 rounded-2xl border p-6 text-left transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        isSelected
          ? "border-primary bg-primary/5"
          : "bg-card hover:border-muted-foreground/30 hover:bg-accent/40",
      )}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <p className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
          {title}
        </p>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      </div>
      <div>
        <p className="text-muted-foreground mt-1.5 text-[0.875rem] leading-[1.55]">
          {description}
        </p>
      </div>
      <Check
        aria-hidden="true"
        className={cn(
          "text-primary absolute top-6 right-6 size-4 transition-opacity duration-200",
          isSelected && !badge ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}

interface WorkStyleStepProps {
  onWorkStyleChange: (value: OnboardingWorkStyle) => void;
  workStyle: null | OnboardingWorkStyle;
}

export function WorkStyleStep({
  onWorkStyleChange,
  workStyle,
}: WorkStyleStepProps) {
  const t = useTranslations("Onboarding.Flow.WorkStyle");

  return (
    <StepShell subtitle={t("subtitle")} title={t("title")}>
      <div className="mx-auto mt-10 grid w-full max-w-xl gap-3 sm:grid-cols-2">
        <ChoiceCard
          description={t("team.description")}
          badge={t("team.badge")}
          isSelected={workStyle === "team"}
          onSelect={() => onWorkStyleChange("team")}
          title={t("team.title")}
        />
        <ChoiceCard
          description={t("solo.description")}
          isSelected={workStyle === "solo"}
          onSelect={() => onWorkStyleChange("solo")}
          title={t("solo.title")}
        />
      </div>
      <p className="text-muted-foreground/70 mx-auto mt-5 max-w-[52ch] text-[0.8125rem]">
        {t("switchLaterHint")}
      </p>
    </StepShell>
  );
}

interface TeamChoiceStepProps {
  onTeamPathChange: (value: OnboardingTeamPath) => void;
  teamPath: null | OnboardingTeamPath;
}

export function TeamChoiceStep({
  onTeamPathChange,
  teamPath,
}: TeamChoiceStepProps) {
  const t = useTranslations("Onboarding.Flow.TeamChoice");

  return (
    <StepShell subtitle={t("subtitle")} title={t("title")}>
      <div className="mx-auto mt-10 grid w-full max-w-xl gap-3 sm:grid-cols-2">
        <ChoiceCard
          description={t("invite.description")}
          isSelected={teamPath === "invite"}
          onSelect={() => onTeamPathChange("invite")}
          title={t("invite.title")}
        />
        <ChoiceCard
          description={t("create.description")}
          isSelected={teamPath === "create"}
          onSelect={() => onTeamPathChange("create")}
          title={t("create.title")}
        />
      </div>
    </StepShell>
  );
}

export interface InviteLinkPreviewState {
  logo: null | string;
  name: string;
}

interface InviteLinkStepProps {
  errorMessage: null | string;
  hasJoined: boolean;
  isResolving: boolean;
  onValueChange: (value: string) => void;
  preview: InviteLinkPreviewState | null;
  value: string;
}

export function InviteLinkStep({
  errorMessage,
  hasJoined,
  isResolving,
  onValueChange,
  preview,
  value,
}: InviteLinkStepProps) {
  const t = useTranslations("Onboarding.Flow.InviteLink");

  const resolvedLogo = preview?.logo
    ? resolveIpfsOrHttpUrl(preview.logo)
    : null;
  const previewLogoUrl =
    resolvedLogo && canUseNextImageSrc(resolvedLogo) ? resolvedLogo : null;

  return (
    <StepShell
      subtitle={hasJoined ? undefined : t("subtitle")}
      title={hasJoined ? t("joinedTitle") : t("title")}
    >
      <div className="mx-auto mt-10 w-full max-w-md text-left">
        {!hasJoined ? (
          <>
            <label
              className="text-muted-foreground mb-2 block text-[0.8125rem] font-medium"
              htmlFor="onboarding-invite-link"
            >
              {t("inputLabel")}
            </label>
            <div className="bg-card has-[:focus-visible]:ring-ring flex h-14 items-center gap-3 overflow-hidden rounded-xl border px-4 has-[:focus-visible]:ring-2">
              <Link2 className="text-muted-foreground size-4 shrink-0" />
              <Input
                id="onboarding-invite-link"
                autoFocus
                inputMode="url"
                spellCheck={false}
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder={t("placeholder")}
                className="h-auto min-w-0 flex-1 truncate dark:bg-transparent border-0 bg-transparent px-0 font-mono text-[0.8125rem] shadow-none focus-visible:ring-0"
              />
              {isResolving ? (
                <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
              ) : null}
            </div>
            <p className="text-muted-foreground/70 mt-2 text-[0.8125rem]">
              {t("hint")}
            </p>
          </>
        ) : null}

        {errorMessage ? (
          <div className="text-destructive mt-4 flex items-start gap-2 text-[0.875rem]">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p>{errorMessage}</p>
          </div>
        ) : null}

        {preview ? (
          <div
            className={cn(
              "animate-in fade-in-0 slide-in-from-bottom-1 flex items-center gap-4 rounded-2xl border p-5 duration-200 motion-reduce:animate-none",
              hasJoined ? "border-primary/20 bg-primary/5" : "bg-card mt-4",
            )}
          >
            <div className="bg-muted relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border">
              {/* An organization logo can point anywhere, including an IPFS
                  gateway. next/image throws on an unconfigured hostname, which
                  would break this step outright, so fall back to the icon. */}
              {previewLogoUrl ? (
                <Image
                  src={previewLogoUrl}
                  alt={preview.name}
                  width={56}
                  height={56}
                  className="size-full object-cover"
                />
              ) : (
                <Building2 className="text-muted-foreground size-6" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[1.0625rem] font-semibold tracking-[-0.01em]">
                {preview.name}
              </p>
              <p className="text-muted-foreground mt-0.5 text-[0.875rem]">
                {hasJoined ? t("joinedSubtitle") : t("previewSubtitle")}
              </p>
            </div>
            {hasJoined ? (
              <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
                <Check className="size-4" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </StepShell>
  );
}

interface InviteLinkJoinButtonProps {
  isDisabled: boolean;
  isJoining: boolean;
  onJoin: () => void;
  organizationName: string;
}

/** Rendered in the flow footer so the primary action stays in one place. */
export function InviteLinkJoinButton({
  isDisabled,
  isJoining,
  onJoin,
  organizationName,
}: InviteLinkJoinButtonProps) {
  const t = useTranslations("Onboarding.Flow.InviteLink");

  return (
    <Button
      variant="primary"
      size="lg"
      className="h-11 px-6"
      disabled={isDisabled || isJoining}
      onClick={onJoin}
    >
      {isJoining && <Loader2 className="size-4 animate-spin" />}
      {isJoining
        ? t("joining")
        : organizationName
          ? t("join", { organization: organizationName })
          : t("joinPending")}
    </Button>
  );
}
