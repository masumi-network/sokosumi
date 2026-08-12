"use client";

import {
  Building2,
  Check,
  CloudUpload,
  Copy,
  FileText,
  Info,
  Link2,
  Loader2,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { type Control, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { Button } from "@/components/ui/button";
import { FileUpload, FileUploadTrigger } from "@/components/ui/file-upload";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ORGANIZATION_LOGO_ACCEPT,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
} from "@/lib/constants/organization-logo";

import {
  CREATE_ORGANIZATION_TRANSLATION_NAMESPACE,
  type CreateOrganizationDetailsValues,
  type CreateOrganizationFlow,
} from "./use-create-organization-flow";

/** The form id the details step submits through, for an external submit button. */
export const CREATE_ORGANIZATION_DETAILS_FORM_ID = "create-org-details";

interface StepProps {
  flow: CreateOrganizationFlow;
}

/**
 * The 96px hero tile on the details step. It fills with the organization's
 * initial as the name is typed, so the object exists before we finish asking
 * for it — the same tile then carries the fetched favicon on the logo step.
 * `useWatch` keeps the keystroke re-render scoped to this tile.
 */
function OrgInitialTile({
  control,
}: {
  control: Control<CreateOrganizationDetailsValues>;
}) {
  const name = useWatch({ control, name: "name" })?.trim() ?? "";

  return (
    <div className="bg-muted flex size-24 items-center justify-center rounded-lg border transition-colors duration-200">
      {name ? (
        <span className="text-muted-foreground text-[2.25rem] leading-none font-semibold tracking-tight">
          {name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <Building2 className="text-muted-foreground/50 size-8" />
      )}
    </div>
  );
}

export function CreateOrganizationDetailsStep({ flow }: StepProps) {
  const t = useTranslations(CREATE_ORGANIZATION_TRANSLATION_NAMESPACE);
  /** Shared error id: the message lives outside FormField so both fields use it. */
  const detailsErrorId = useId();
  const { form, handleDetailsContinue } = flow;

  return (
    <Form {...form}>
      <form
        id={CREATE_ORGANIZATION_DETAILS_FORM_ID}
        onSubmit={handleDetailsContinue}
      >
        <div className="flex min-h-24 flex-none items-center justify-center">
          <OrgInitialTile control={form.control} />
        </div>
        <h2 className="mt-8 text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[1.875rem]">
          {t("Details.title")}
        </h2>
        <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-balance">
          {t("Details.subtitle")}
        </p>

        <div className="mx-auto mt-10 w-full max-w-md">
          <div className="bg-card has-[:focus-visible]:ring-ring divide-y overflow-hidden rounded-xl border text-left has-[:focus-visible]:ring-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="focus-within:bg-accent/40 grid grid-cols-[88px_1fr] items-center gap-3 space-y-0 px-4 transition-colors">
                  <FormLabel className="text-muted-foreground text-[0.8125rem] font-normal">
                    {t("Details.nameLabel")}
                  </FormLabel>
                  <FormControl
                    aria-describedby={
                      form.formState.errors.name ? detailsErrorId : undefined
                    }
                  >
                    <Input
                      autoFocus
                      placeholder={t("Details.namePlaceholder")}
                      className="placeholder:text-muted-foreground/50 h-14 dark:bg-transparent border-0 bg-transparent px-0 text-[0.9375rem] shadow-none focus-visible:ring-0"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem className="focus-within:bg-accent/40 grid grid-cols-[88px_1fr] items-center gap-3 space-y-0 px-4 transition-colors">
                  <FormLabel className="text-muted-foreground text-[0.8125rem] font-normal">
                    {t("Details.urlLabel")}
                  </FormLabel>
                  <FormControl
                    aria-describedby={
                      form.formState.errors.url ? detailsErrorId : undefined
                    }
                  >
                    <Input
                      inputMode="url"
                      placeholder={t("Details.urlPlaceholder")}
                      className="placeholder:text-muted-foreground/50 h-14 dark:bg-transparent border-0 bg-transparent px-0 text-[0.9375rem] shadow-none focus-visible:ring-0"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
          {/* Fixed slot so a validation message never resizes the stage */}
          <div className="min-h-5 text-left">
            {/* Plain <p>, not <FormMessage>: lives outside FormField so both
                fields can share one error line without growing the card.
                FormControl aria-invalid still comes from field state;
                aria-describedby points here. */}
            <p
              id={detailsErrorId}
              role="alert"
              className="text-destructive text-[0.8125rem]"
            >
              {form.formState.errors.name?.message ??
                form.formState.errors.url?.message}
            </p>
          </div>
          <p className="text-muted-foreground/70 text-left text-[0.8125rem]">
            {t("Details.urlHint")}
          </p>
        </div>
      </form>
    </Form>
  );
}

export function CreateOrganizationLogoStep({ flow }: StepProps) {
  const t = useTranslations(CREATE_ORGANIZATION_TRANSLATION_NAMESPACE);
  const {
    brandDomain,
    handleLogoUpload,
    handleRemoveLogo,
    isResolvingLogo,
    isUploadingLogo,
    logoUrl,
    pendingLogoFiles,
    setPendingLogoFiles,
  } = flow;

  const logoLabels = {
    fileTooLarge: t("Logo.uploadError"),
    fileTypeNotAccepted: t("Logo.uploadError"),
    maxFilesExceeded: t("Logo.uploadError"),
    previewAlt: t("Logo.previewAlt"),
    remove: t("Logo.remove"),
    replace: t("Logo.replace"),
    // Shown when there is no logo yet — "Replace logo" would be a lie there.
    upload: t("Logo.upload"),
    uploadError: t("Logo.uploadError"),
  };

  return (
    <>
      <div className="flex min-h-24 flex-none items-center justify-center">
        {isResolvingLogo ? (
          <div className="bg-muted flex size-24 items-center justify-center rounded-lg border">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        ) : (
          <OrganizationLogoUploadField
            disabled={isUploadingLogo}
            isUploading={isUploadingLogo}
            labels={logoLabels}
            logoValue={logoUrl}
            onPendingLogoFilesChange={setPendingLogoFiles}
            onRemove={handleRemoveLogo}
            onUpload={handleLogoUpload}
            pendingLogoFiles={pendingLogoFiles}
          />
        )}
      </div>
      <h2 className="mt-8 text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[1.875rem]">
        {t("Logo.title")}
      </h2>
      <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-balance">
        {isResolvingLogo
          ? t("Logo.generating")
          : logoUrl
            ? brandDomain
              ? t("Logo.found", { domain: brandDomain })
              : t("Logo.foundNoDomain")
            : t("Logo.notFound")}
      </p>

      {/* The hover overlay alone reads as decoration, so the upload target
          gets an explicit labelled control. */}
      {!isResolvingLogo && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <FileUpload
            value={pendingLogoFiles}
            onValueChange={setPendingLogoFiles}
            accept={ORGANIZATION_LOGO_ACCEPT}
            maxFiles={1}
            maxSize={ORGANIZATION_LOGO_MAX_SIZE_BYTES}
            multiple={false}
            disabled={isUploadingLogo}
            onAccept={handleLogoUpload}
            onFileReject={(_file: File, message?: string) => {
              toast.error(message ?? t("Logo.uploadError"));
            }}
          >
            <FileUploadTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 px-6"
                disabled={isUploadingLogo}
              >
                {isUploadingLogo ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CloudUpload className="size-4" />
                )}
                {logoUrl ? t("Logo.replace") : t("Logo.upload")}
              </Button>
            </FileUploadTrigger>
          </FileUpload>
          <p className="text-muted-foreground/70 text-[0.8125rem]">
            {t("Logo.uploadHint")}
          </p>
        </div>
      )}
    </>
  );
}

export function CreateOrganizationBrandStep({ flow }: StepProps) {
  const t = useTranslations(CREATE_ORGANIZATION_TRANSLATION_NAMESPACE);
  const { brand, brandDomain, normalizedUrl } = flow;

  return (
    <>
      <div className="flex min-h-24 flex-none items-center justify-center">
        {brand.status === "completed" ? (
          <div className="bg-primary/10 border-primary/20 flex size-24 items-center justify-center rounded-lg border transition-colors duration-200">
            <Check className="text-primary animate-in fade-in-0 size-7 duration-200" />
          </div>
        ) : brand.status === "failed" ? (
          <div className="bg-muted flex size-24 items-center justify-center rounded-lg border">
            <Sparkles className="text-muted-foreground size-6" />
          </div>
        ) : (
          <div className="bg-muted flex size-24 items-center justify-center rounded-lg border transition-colors duration-200">
            <Loader2 className="text-primary size-6 animate-spin" />
          </div>
        )}
      </div>

      <h2 className="mt-8 text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[1.875rem]">
        {t("Brand.title")}
      </h2>

      <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-balance">
        {brand.status === "completed"
          ? brandDomain
            ? t("Brand.generated", { domain: brandDomain })
            : t("Brand.generatedNoDomain")
          : brand.status === "failed"
            ? t("Brand.failedTitle")
            : brandDomain
              ? t("Brand.generating", { domain: brandDomain })
              : t("Brand.generatingNoDomain")}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("Brand.title")}
              className="focus-visible:ring-ring ml-1.5 inline-flex size-5 translate-y-[3px] items-center justify-center rounded-md outline-none focus-visible:ring-2"
            >
              <Info className="text-muted-foreground/60 hover:text-foreground size-3.5 transition-colors duration-200" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {t("Brand.tooltip")}
          </TooltipContent>
        </Tooltip>
      </p>

      {brand.status !== "completed" && (
        <p className="text-muted-foreground/70 mt-3 text-[0.8125rem]">
          {brand.status === "failed"
            ? t("Brand.failedSubtitle")
            : t("Brand.skipHint")}
        </p>
      )}

      {brand.status === "completed" && (
        <div className="mt-10">
          <div className="bg-muted/60 text-muted-foreground mx-auto flex w-fit items-center gap-2 rounded-xl border px-3 py-2">
            <FileText className="size-4" />
            <span className="font-mono text-[0.8125rem]">DESIGN.md</span>
          </div>
          <p className="text-muted-foreground/70 mt-4 text-[0.8125rem]">
            {t("Brand.editHint")}
          </p>
        </div>
      )}

      {brand.status === "failed" && (
        <div className="mt-10">
          <Button
            variant="outline"
            size="lg"
            className="h-11 px-6"
            onClick={() => {
              if (normalizedUrl) {
                void brand.generate({ force: true, url: normalizedUrl });
              }
            }}
          >
            <RotateCw className="size-4" />
            {t("Brand.retry")}
          </Button>
        </div>
      )}
    </>
  );
}

export function CreateOrganizationInviteStep({ flow }: StepProps) {
  const t = useTranslations(CREATE_ORGANIZATION_TRANSLATION_NAMESPACE);
  const {
    copied,
    emails,
    handleCopyLink,
    handleSendInvites,
    inviteLink,
    isCreatingLink,
    isSendingInvites,
    linkFailed,
    mintInviteLink,
    organizationName,
    setEmails,
  } = flow;

  return (
    <>
      {/* Tighter than the setup steps: this slide stacks the link row AND the
          email box, and with a two-line title it must still fit the stage
          without scrolling. */}
      <div className="flex min-h-14 flex-none items-center justify-center">
        <div className="bg-primary/10 border-primary/20 flex size-14 items-center justify-center rounded-lg border">
          <Check className="text-primary animate-in fade-in-0 size-6 duration-200" />
        </div>
      </div>
      <h2 className="mt-4 text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[1.875rem]">
        {organizationName
          ? t("Invite.title", { organization: organizationName })
          : t("Invite.titleFallback")}
      </h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-balance">
        {t("Invite.subtitle")}
      </p>

      <div className="mx-auto mt-5 w-full max-w-md">
        <div className="bg-muted/60 has-[:focus-visible]:ring-ring flex h-14 items-center gap-3 rounded-xl border pr-2 pl-4 has-[:focus-visible]:ring-2">
          <Link2 className="text-muted-foreground size-4 shrink-0" />
          {isCreatingLink ? (
            <Skeleton className="h-4 w-56 rounded-sm" />
          ) : (
            <Input
              readOnly
              value={inviteLink ?? ""}
              onFocus={(event) => event.currentTarget.select()}
              className="text-muted-foreground h-auto min-w-0 flex-1 truncate dark:bg-transparent border-0 bg-transparent px-0 font-mono text-[0.8125rem] shadow-none focus-visible:ring-0"
            />
          )}
          {linkFailed && !inviteLink ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-9 shrink-0 transition-colors duration-200"
              disabled={isCreatingLink}
              onClick={() => void mintInviteLink()}
            >
              <RotateCw className="size-4" />
              <span className="hidden sm:inline">{t("Invite.regenerate")}</span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-9 shrink-0 transition-colors duration-200"
              disabled={!inviteLink || isCreatingLink}
              onClick={() => void handleCopyLink()}
              aria-label={copied ? t("Invite.copied") : t("Invite.copy")}
            >
              {copied ? (
                <Check className="text-primary size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              <span className="hidden sm:inline">
                {copied ? t("Invite.copied") : t("Invite.copy")}
              </span>
            </Button>
          )}
        </div>
        <p className="text-muted-foreground/70 mt-2 text-left text-[0.8125rem]">
          {t("Invite.linkHint")}
        </p>

        <div className="bg-border my-3 h-px w-full" />

        <Textarea
          rows={2}
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
          placeholder={t("Invite.emailsPlaceholder")}
          className="bg-muted/60 dark:bg-muted/60 min-h-14 resize-none rounded-xl border px-4 py-3 text-[0.9375rem] shadow-none"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-muted-foreground/70 text-left text-[0.8125rem]">
            {t("Invite.emailsHint")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            disabled={!emails.trim() || isSendingInvites}
            onClick={() => void handleSendInvites()}
          >
            {isSendingInvites && <Loader2 className="size-4 animate-spin" />}
            {isSendingInvites ? t("Invite.sending") : t("Invite.sendInvites")}
          </Button>
        </div>
      </div>
    </>
  );
}

/** Renders whichever step the flow is on. */
export function CreateOrganizationStep({ flow }: StepProps) {
  switch (flow.step) {
    case 0:
      return <CreateOrganizationDetailsStep flow={flow} />;
    case 1:
      return <CreateOrganizationLogoStep flow={flow} />;
    case 2:
      return <CreateOrganizationBrandStep flow={flow} />;
    default:
      return <CreateOrganizationInviteStep flow={flow} />;
  }
}
