"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { buildOrganizationMetadataWithUrl } from "@sokosumi/utils";
import {
  ArrowLeft,
  ArrowRight,
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
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import {
  DESIGN_MD_TRANSLATION_NAMESPACE,
  type DesignMdOwner,
  useDesignMdGeneration,
} from "@/components/design-md";
import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
  createOrganizationInviteLink,
  generateOrganizationSlug,
  inviteOrganizationMembersBulk,
  resolveOrganizationSiteIcon,
} from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import {
  ORGANIZATION_LOGO_ACCEPT,
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
  ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
} from "@/lib/constants/organization-logo";
import { cn } from "@/lib/utils";
import {
  ClientTimeoutError,
  raceWithTimeout,
} from "@/lib/utils/race-with-timeout";
import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

const TOTAL_STEPS = 4;
/**
 * Index of the terminal step. Setup ends with the brand guidelines; this step
 * only confirms the result and offers invites, so it has no way back.
 */
const SUCCESS_STEP = 3;
const COPIED_RESET_MS = 2000;

function normalizeWebsiteUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function getDomainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface DetailsFormValues {
  name: string;
  url: string;
}

/**
 * The 96px hero tile on step 1. It fills with the organization's initial as the
 * name is typed, so the object exists before we finish asking for it — the same
 * tile then carries the fetched favicon on step 2. `useWatch` keeps the
 * keystroke re-render scoped to this tile instead of the whole wizard.
 */
function OrgInitialTile({ control }: { control: Control<DetailsFormValues> }) {
  const name = useWatch({ control, name: "name" })?.trim() ?? "";

  return (
    <div className="bg-muted flex size-24 items-center justify-center rounded-lg border transition-colors duration-200">
      {name ? (
        <span className="text-muted-foreground text-[36px] leading-none font-semibold tracking-tight">
          {name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <Building2 className="text-muted-foreground/50 size-8" />
      )}
    </div>
  );
}

interface CreateOrganizationWizardProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

export function CreateOrganizationWizard({
  open,
  onOpenChange,
}: CreateOrganizationWizardProps) {
  const t = useTranslations(
    "Components.Organizations.CreateOrganizationWizard",
  );
  const tDesignMd = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);
  const router = useRouter();
  const { handleSelectWorkspace } = useWorkspaceSwitcher();

  const [step, setStep] = useState(0);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [normalizedUrl, setNormalizedUrl] = useState<string | null>(null);
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);

  const [logoUrl, setLogoUrl] = useState("");
  const [isResolvingLogo, setIsResolvingLogo] = useState(false);
  const [pendingLogoFiles, setPendingLogoFiles] = useState<File[]>([]);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emails, setEmails] = useState("");
  const [isSendingInvites, setIsSendingInvites] = useState(false);

  const logoStartedRef = useRef(false);
  const brandStartedRef = useRef(false);
  const linkStartedRef = useRef(false);
  const orgCreateInFlightRef = useRef(false);
  /** Last values actually persisted, so a step-back edit can be detected. */
  const savedValuesRef = useRef<{ name: string; url: string } | null>(null);
  /**
   * Set when the website changed after a guide was already generated. Without
   * `force`, the service short-circuits and returns the guide built from the
   * previous URL.
   */
  const brandForceRef = useRef(false);

  const detailsSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(2, { message: t("Details.nameInvalid") })
          .max(50, { message: t("Details.nameInvalid") }),
        url: z
          .string()
          .trim()
          .refine((value) => normalizeWebsiteUrl(value) !== null, {
            message: t("Details.urlInvalid"),
          }),
      }),
    [t],
  );

  const form = useForm<DetailsFormValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: "", url: "" },
  });

  const designMdOwner = useMemo<DesignMdOwner>(
    () => ({ type: "organization", organizationId: organizationId ?? "" }),
    [organizationId],
  );

  const brand = useDesignMdGeneration({
    messages: {
      generationFailed: tDesignMd("generateError"),
      saveFailed: tDesignMd("saveError"),
      startFailed: tDesignMd("startGenerateError"),
    },
    owner: designMdOwner,
  });

  const resetAll = useCallback(() => {
    setStep(0);
    setOrganizationId(null);
    setOrganizationName("");
    setNormalizedUrl(null);
    setIsCreatingOrg(false);
    setLogoUrl("");
    setIsResolvingLogo(false);
    setPendingLogoFiles([]);
    setIsUploadingLogo(false);
    setInviteLink(null);
    setIsCreatingLink(false);
    setCopied(false);
    setEmails("");
    setIsSendingInvites(false);
    logoStartedRef.current = false;
    brandStartedRef.current = false;
    linkStartedRef.current = false;
    orgCreateInFlightRef.current = false;
    savedValuesRef.current = null;
    brandForceRef.current = false;
    brand.reset();
    form.reset({ name: "", url: "" });
  }, [brand, form]);

  // Reset to a clean slate whenever the wizard is (re)opened.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      resetAll();
    }
    wasOpenRef.current = open;
  }, [open, resetAll]);

  const persistLogo = useCallback(
    async (nextLogo: string) => {
      if (!organizationId) return;
      await authClient.organization.update({
        organizationId,
        data: { logo: nextLogo },
      });
    },
    [organizationId],
  );

  const resolveLogoFromWebsite = useCallback(
    async (orgId: string, url: string) => {
      setIsResolvingLogo(true);
      try {
        const result = await resolveOrganizationSiteIcon({ url });
        if (result.ok && result.data.url) {
          setLogoUrl(result.data.url);
          await authClient.organization.update({
            organizationId: orgId,
            data: { logo: result.data.url },
          });
        }
      } catch (error) {
        console.error("Failed to resolve organization logo", error);
      } finally {
        setIsResolvingLogo(false);
      }
    },
    [],
  );

  /**
   * Creates the organization on first continue, and on later passes applies
   * any edits made after stepping back. A changed website invalidates both
   * derived artifacts, so the logo and brand guidelines are re-derived from
   * the new site rather than silently keeping the first one.
   */
  const handleCreateOrganization = useCallback(async (): Promise<
    string | null
  > => {
    if (orgCreateInFlightRef.current) return null;

    const values = form.getValues();
    const url = normalizeWebsiteUrl(values.url);
    if (!url) return null;

    if (organizationId) {
      const saved = savedValuesRef.current;
      const nameChanged = saved?.name !== values.name;
      const urlChanged = saved?.url !== url;
      if (!nameChanged && !urlChanged) return organizationId;

      orgCreateInFlightRef.current = true;
      setIsCreatingOrg(true);
      try {
        const result = await authClient.organization.update({
          organizationId,
          data: {
            name: values.name,
            // Only rewrite metadata when the website itself changed. The
            // DESIGN.md pointer it drops described the previous site, and
            // step 3 regenerates it for the new one.
            ...(urlChanged
              ? {
                  metadata:
                    buildOrganizationMetadataWithUrl(null, url) ?? undefined,
                }
              : {}),
          },
        });

        if (result.error) {
          toast.error(result.error.message ?? t("Errors.createFailed"));
          return null;
        }

        savedValuesRef.current = { name: values.name, url };
        setOrganizationName(values.name);

        if (urlChanged) {
          setNormalizedUrl(url);
          setLogoUrl("");
          setPendingLogoFiles([]);
          logoStartedRef.current = false;
          brandStartedRef.current = false;
          brandForceRef.current = true;
          brand.reset();
        }

        return organizationId;
      } catch (error) {
        console.error("Failed to update organization", error);
        toast.error(t("Errors.createFailed"));
        return null;
      } finally {
        orgCreateInFlightRef.current = false;
        setIsCreatingOrg(false);
      }
    }

    orgCreateInFlightRef.current = true;
    setIsCreatingOrg(true);
    try {
      const slugResult = await generateOrganizationSlug({
        name: values.name,
        metadata: { url },
        logo: "",
      });
      if (!slugResult.ok) {
        toast.error(t("Errors.createFailed"));
        return null;
      }

      const metadata = buildOrganizationMetadataWithUrl(null, url);
      const created = await authClient.organization.create({
        slug: slugResult.data,
        name: values.name,
        ...(metadata && { metadata }),
      });

      if (created.error || !created.data) {
        const message = created.error?.message ?? t("Errors.createFailed");
        if (created.error?.status === 401) {
          toast.error(message, {
            action: {
              label: t("Errors.unauthorizedAction"),
              onClick: () => router.push("/login"),
            },
          });
        } else {
          toast.error(message);
        }
        return null;
      }

      setOrganizationId(created.data.id);
      setNormalizedUrl(url);
      savedValuesRef.current = { name: values.name, url };
      return created.data.id;
    } catch (error) {
      console.error("Failed to create organization", error);
      toast.error(t("Errors.createFailed"));
      return null;
    } finally {
      orgCreateInFlightRef.current = false;
      setIsCreatingOrg(false);
    }
  }, [brand, form, organizationId, router, t]);

  const handleDetailsContinue = form.handleSubmit(async () => {
    const orgId = await handleCreateOrganization();
    if (orgId) setStep(1);
  });

  // Step 1 — resolve the favicon once we have an org + website.
  useEffect(() => {
    if (
      step === 1 &&
      organizationId &&
      normalizedUrl &&
      !logoStartedRef.current
    ) {
      logoStartedRef.current = true;
      void resolveLogoFromWebsite(organizationId, normalizedUrl);
    }
  }, [step, organizationId, normalizedUrl, resolveLogoFromWebsite]);

  // Step 2 — generate the brand guidelines once.
  useEffect(() => {
    if (
      step === 2 &&
      organizationId &&
      normalizedUrl &&
      !brandStartedRef.current
    ) {
      brandStartedRef.current = true;
      const force = brandForceRef.current;
      brandForceRef.current = false;
      void brand.generate({ force, url: normalizedUrl });
    }
  }, [step, organizationId, normalizedUrl, brand]);

  // Step 3 — mint the shareable invite link once.
  useEffect(() => {
    if (step === 3 && organizationId && !linkStartedRef.current) {
      linkStartedRef.current = true;
      setIsCreatingLink(true);
      void (async () => {
        try {
          const result = await createOrganizationInviteLink({
            organizationId,
          });
          if (result.ok) {
            setInviteLink(result.data.url);
          } else {
            toast.error(t("Invite.linkError"));
          }
        } catch (error) {
          console.error("Failed to create invite link", error);
          toast.error(t("Invite.linkError"));
        } finally {
          setIsCreatingLink(false);
        }
      })();
    }
  }, [step, organizationId, t]);

  const handleLogoUpload = useCallback(
    async (files: File[]) => {
      const logoFile = files[0];
      if (!logoFile) return;
      setIsUploadingLogo(true);
      try {
        const uploaded = await raceWithTimeout(
          uploadUserFileDirect(logoFile, {
            allowedContentTypes: [...ORGANIZATION_LOGO_ALLOWED_MIME_TYPES],
            maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
          }),
          ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
        );
        setLogoUrl(uploaded.publicUrl);
        await persistLogo(uploaded.publicUrl);
      } catch (error) {
        toast.error(
          error instanceof ClientTimeoutError
            ? t("Logo.uploadError")
            : getUserFileUploadErrorMessage(error, t("Logo.uploadError")),
        );
      } finally {
        setPendingLogoFiles([]);
        setIsUploadingLogo(false);
      }
    },
    [persistLogo, t],
  );

  const handleRemoveLogo = useCallback(() => {
    setLogoUrl("");
    setPendingLogoFiles([]);
    void persistLogo("");
  }, [persistLogo]);

  const handleCopyLink = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      toast.error(t("Invite.linkError"));
    }
  }, [inviteLink, t]);

  const handleSendInvites = useCallback(async () => {
    if (!organizationId || !emails.trim()) return;
    setIsSendingInvites(true);
    try {
      const result = await inviteOrganizationMembersBulk({
        organizationId,
        rawEmails: emails,
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Invite.emailError"));
        return;
      }
      const sent = result.data.results.filter(
        (row) => row.status === "sent",
      ).length;
      const failed = result.data.results.length - sent;
      toast.success(t("Invite.inviteSummary", { sent, failed }));
      setEmails("");
    } catch (error) {
      console.error("Failed to send invites", error);
      toast.error(t("Invite.emailError"));
    } finally {
      setIsSendingInvites(false);
    }
  }, [organizationId, emails, t]);

  const handleFinish = useCallback(() => {
    if (!organizationId) {
      onOpenChange(false);
      return;
    }
    void handleSelectWorkspace(organizationId, {
      shouldRedirectAgentJobsBasePath: false,
    });
    onOpenChange(false);
  }, [handleSelectWorkspace, onOpenChange, organizationId]);

  const isBusy = isCreatingOrg || isUploadingLogo;
  const brandDomain = normalizedUrl ? getDomainLabel(normalizedUrl) : "";

  const handleRequestClose = (nextOpen: boolean) => {
    if (isBusy) return;
    onOpenChange(nextOpen);
  };

  const logoLabels = {
    fileTooLarge: t("Logo.uploadError"),
    fileTypeNotAccepted: t("Logo.uploadError"),
    maxFilesExceeded: t("Logo.uploadError"),
    previewAlt: t("Logo.previewAlt"),
    remove: t("Logo.remove"),
    replace: t("Logo.replace"),
    upload: t("Logo.replace"),
    uploadError: t("Logo.uploadError"),
  };

  return (
    <Dialog open={open} onOpenChange={handleRequestClose}>
      <DialogContent className="bg-background top-0 left-0 grid h-dvh w-screen max-w-none! translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-none border-0 p-0 sm:top-[50%] sm:left-[50%] sm:h-[600px] sm:max-h-[92dvh] sm:w-[calc(100vw-4rem)] sm:max-w-2xl! sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border [&>button]:top-5 [&>button]:right-5 sm:[&>button]:top-6 sm:[&>button]:right-6">
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("description")}
        </DialogDescription>

        {/* Progress rail + slide counter */}
        <div className="relative flex items-center px-6 py-5 sm:px-8 sm:py-6">
          <div className="absolute inset-x-0 top-0 flex h-[3px] gap-1">
            {Array.from({ length: TOTAL_STEPS }).map((_, index) => (
              <span
                key={index}
                className="bg-border h-full flex-1 overflow-hidden"
              >
                <span
                  className={cn(
                    "bg-primary block h-full w-full origin-left transition-transform duration-200 ease-out motion-reduce:transition-none",
                    index <= step ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </span>
            ))}
          </div>
          <span className="text-muted-foreground/60 text-[11px] font-medium tracking-[0.16em] tabular-nums">
            {String(step + 1).padStart(2, "0")} /{" "}
            {String(TOTAL_STEPS).padStart(2, "0")}
          </span>
          <span className="sr-only" aria-live="polite">
            {step + 1} / {TOTAL_STEPS}
          </span>
        </div>

        {/* Stage — one focal object per step, fixed height so nothing jumps */}
        {/* `m-auto` on the child, not `justify-center` on the scroller: a
            centered flex child that outgrows its container gets clipped at the
            top with no way to scroll back up. */}
        <div className="flex min-h-0 flex-col items-center overflow-y-auto px-6 py-6 text-center sm:px-16">
          <div
            key={step}
            className="animate-in fade-in-0 slide-in-from-bottom-1 my-auto w-full duration-200 ease-out motion-reduce:animate-none"
          >
            {/* Step 1 — Details */}
            {step === 0 && (
              <Form {...form}>
                <form id="create-org-details" onSubmit={handleDetailsContinue}>
                  <div className="flex min-h-24 flex-none items-center justify-center">
                    <OrgInitialTile control={form.control} />
                  </div>
                  <h2 className="mt-8 text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[30px]">
                    {t("Details.title")}
                  </h2>
                  <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[15px] leading-[1.6] text-balance">
                    {t("Details.subtitle")}
                  </p>

                  <div className="mx-auto mt-10 w-full max-w-md">
                    <div className="bg-card has-[:focus-visible]:ring-ring divide-y overflow-hidden rounded-xl border text-left has-[:focus-visible]:ring-2">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem className="focus-within:bg-accent/40 grid grid-cols-[88px_1fr] items-center gap-3 space-y-0 px-4 transition-colors">
                            <FormLabel className="text-muted-foreground text-[13px] font-normal">
                              {t("Details.nameLabel")}
                            </FormLabel>
                            <FormControl>
                              <Input
                                autoFocus
                                placeholder={t("Details.namePlaceholder")}
                                className="placeholder:text-muted-foreground/50 h-14 dark:bg-transparent border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0"
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
                            <FormLabel className="text-muted-foreground text-[13px] font-normal">
                              {t("Details.urlLabel")}
                            </FormLabel>
                            <FormControl>
                              <Input
                                inputMode="url"
                                placeholder={t("Details.urlPlaceholder")}
                                className="placeholder:text-muted-foreground/50 h-14 dark:bg-transparent border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0"
                                {...field}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    {/* Fixed slot so a validation message never resizes the stage */}
                    <div className="min-h-5 text-left">
                      {/* Plain <p>, not <FormMessage>: this slot sits outside
                          any <FormField>, so it has no field context to read. */}
                      <p className="text-destructive text-[13px]">
                        {form.formState.errors.name?.message ??
                          form.formState.errors.url?.message}
                      </p>
                    </div>
                    <p className="text-muted-foreground/70 text-left text-[13px]">
                      {t("Details.urlHint")}
                    </p>
                  </div>
                </form>
              </Form>
            )}

            {/* Step 2 — Logo */}
            {step === 1 && (
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
                <h2 className="mt-8 text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[30px]">
                  {t("Logo.title")}
                </h2>
                <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[15px] leading-[1.6] text-balance">
                  {isResolvingLogo
                    ? t("Logo.generating")
                    : logoUrl
                      ? brandDomain
                        ? t("Logo.found", { domain: brandDomain })
                        : t("Logo.foundNoDomain")
                      : t("Logo.notFound")}
                </p>

                {/* The hover overlay alone reads as decoration, so the upload
                    target gets an explicit labelled control. */}
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
                    <p className="text-muted-foreground/70 text-[13px]">
                      {t("Logo.uploadHint")}
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Step 3 — Brand Guidelines */}
            {step === 2 && (
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

                <h2 className="mt-8 text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[30px]">
                  {t("Brand.title")}
                </h2>

                <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[15px] leading-[1.6] text-balance">
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
                  <p className="text-muted-foreground/70 mt-3 text-[13px]">
                    {brand.status === "failed"
                      ? t("Brand.failedSubtitle")
                      : t("Brand.skipHint")}
                  </p>
                )}

                {brand.status === "completed" && (
                  <div className="mt-10">
                    <div className="bg-muted/60 text-muted-foreground mx-auto flex w-fit items-center gap-2 rounded-xl border px-3 py-2">
                      <FileText className="size-4" />
                      <span className="font-mono text-[13px]">DESIGN.md</span>
                    </div>
                    <p className="text-muted-foreground/70 mt-4 text-[13px]">
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
                          void brand.generate({
                            force: true,
                            url: normalizedUrl,
                          });
                        }
                      }}
                    >
                      <RotateCw className="size-4" />
                      {t("Brand.retry")}
                    </Button>
                  </div>
                )}
              </>
            )}

            {/* Step 4 — created; confirm and invite */}
            {step === SUCCESS_STEP && (
              <>
                <div className="flex min-h-16 flex-none items-center justify-center">
                  <div className="bg-primary/10 border-primary/20 flex size-16 items-center justify-center rounded-lg border">
                    <Check className="text-primary animate-in fade-in-0 size-7 duration-200" />
                  </div>
                </div>
                <h2 className="mt-5 text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[30px]">
                  {organizationName
                    ? t("Invite.title", { organization: organizationName })
                    : t("Invite.titleFallback")}
                </h2>
                <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[15px] leading-[1.6] text-balance">
                  {t("Invite.subtitle")}
                </p>

                <div className="mx-auto mt-6 w-full max-w-md">
                  <div className="bg-muted/60 has-[:focus-visible]:ring-ring flex h-14 items-center gap-3 rounded-xl border pr-2 pl-4 has-[:focus-visible]:ring-2">
                    <Link2 className="text-muted-foreground size-4 shrink-0" />
                    {isCreatingLink ? (
                      <Skeleton className="h-4 w-56 rounded-sm" />
                    ) : (
                      <Input
                        readOnly
                        value={inviteLink ?? ""}
                        onFocus={(event) => event.currentTarget.select()}
                        className="text-muted-foreground h-auto min-w-0 flex-1 truncate dark:bg-transparent border-0 bg-transparent px-0 font-mono text-[13px] shadow-none focus-visible:ring-0"
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-9 shrink-0 transition-colors duration-200"
                      disabled={!inviteLink || isCreatingLink}
                      onClick={() => void handleCopyLink()}
                      aria-label={
                        copied ? t("Invite.copied") : t("Invite.copy")
                      }
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
                  </div>
                  <p className="text-muted-foreground/70 mt-3 text-left text-[13px]">
                    {t("Invite.linkHint")}
                  </p>

                  <div className="bg-border my-4 h-px w-full" />

                  <Textarea
                    rows={2}
                    value={emails}
                    onChange={(event) => setEmails(event.target.value)}
                    placeholder={t("Invite.emailsPlaceholder")}
                    className="bg-muted/60 dark:bg-muted/60 min-h-16 resize-none rounded-xl border px-4 py-3 text-[15px] shadow-none"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-muted-foreground/70 text-left text-[13px]">
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
                      {isSendingInvites && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      {isSendingInvites
                        ? t("Invite.sending")
                        : t("Invite.sendInvites")}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer — exactly one filled action on screen */}
        <div className="bg-background flex items-center justify-between gap-3 px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-6 sm:pb-6">
          {/* Back stops at the last setup step. Past it there is nothing left
              to configure, and the organization already exists — offering
              "Back" there would imply the creation can be undone. */}
          {step > 0 && step < SUCCESS_STEP ? (
            <Button
              variant="ghost"
              className="text-muted-foreground h-11 px-4"
              onClick={() => setStep((current) => current - 1)}
              disabled={isBusy}
            >
              <ArrowLeft className="size-4" />
              {t("Nav.back")}
            </Button>
          ) : step < SUCCESS_STEP ? (
            <div />
          ) : null}

          {step === 0 && (
            <Button
              type="submit"
              form="create-org-details"
              variant="primary"
              size="lg"
              className="h-11 px-6"
              disabled={isBusy}
            >
              {isCreatingOrg && <Loader2 className="size-4 animate-spin" />}
              {isCreatingOrg ? t("Nav.creating") : t("Nav.next")}
              {!isCreatingOrg && <ArrowRight className="size-4" />}
            </Button>
          )}
          {step === 1 && (
            <Button
              variant="primary"
              size="lg"
              className="h-11 px-6"
              onClick={() => setStep((current) => current + 1)}
              disabled={isBusy}
            >
              {t("Nav.next")}
              <ArrowRight className="size-4" />
            </Button>
          )}
          {/* Last configurable step: the label says so, and drops the forward
              arrow so it doesn't read as just another "next". */}
          {step === 2 && (
            <Button
              variant="primary"
              size="lg"
              className="h-11 px-6"
              onClick={() => setStep((current) => current + 1)}
              disabled={isBusy}
            >
              {t("Nav.finishSetup")}
            </Button>
          )}
          {step === SUCCESS_STEP && (
            <Button
              variant="primary"
              size="lg"
              className="h-11 w-full px-6"
              onClick={handleFinish}
            >
              {t("Nav.finish")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
