"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { buildOrganizationMetadataWithUrl } from "@sokosumi/utils";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Info,
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
import { useForm } from "react-hook-form";
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
  ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
} from "@/lib/constants/organization-logo";
import {
  ClientTimeoutError,
  raceWithTimeout,
} from "@/lib/utils/race-with-timeout";
import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

const TOTAL_STEPS = 4;
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

  const detailsSchema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(2).max(50),
        url: z
          .string()
          .trim()
          .refine((value) => normalizeWebsiteUrl(value) !== null, {
            message: t("Details.urlHint"),
          }),
      }),
    [t],
  );

  const form = useForm<z.infer<typeof detailsSchema>>({
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

  const handleCreateOrganization = useCallback(async (): Promise<
    string | null
  > => {
    if (organizationId) return organizationId;
    if (orgCreateInFlightRef.current) return null;

    const values = form.getValues();
    const url = normalizeWebsiteUrl(values.url);
    if (!url) return null;

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
      toast.success(t("Success.created"));
      return created.data.id;
    } catch (error) {
      console.error("Failed to create organization", error);
      toast.error(t("Errors.createFailed"));
      return null;
    } finally {
      orgCreateInFlightRef.current = false;
      setIsCreatingOrg(false);
    }
  }, [form, organizationId, router, t]);

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
      void brand.generate({ url: normalizedUrl });
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
      <DialogContent className="w-[95vw] max-w-md! gap-0 overflow-hidden p-0 sm:max-w-md!">
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("description")}
        </DialogDescription>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-1.5 pt-6">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step
                  ? "bg-primary w-5"
                  : i < step
                    ? "bg-primary/40 w-1.5"
                    : "bg-muted-foreground/20 w-1.5"
              }`}
            />
          ))}
        </div>

        <div className="min-h-[320px] px-6 py-8">
          {/* Step 0 — Details */}
          {step === 0 && (
            <div className="space-y-6">
              <div className="space-y-1.5 text-center">
                <h2 className="text-xl font-semibold tracking-tight">
                  {t("Details.title")}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t("Details.subtitle")}
                </p>
              </div>
              <Form {...form}>
                <form
                  id="create-org-details"
                  onSubmit={handleDetailsContinue}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Details.nameLabel")}</FormLabel>
                        <FormControl>
                          <Input
                            autoFocus
                            placeholder={t("Details.namePlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Details.urlLabel")}</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="url"
                            placeholder={t("Details.urlPlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t("Details.urlHint")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </form>
              </Form>
            </div>
          )}

          {/* Step 1 — Logo */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="space-y-1.5 text-center">
                <h2 className="text-xl font-semibold tracking-tight">
                  {t("Logo.title")}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {isResolvingLogo
                    ? t("Logo.generating")
                    : logoUrl
                      ? t("Logo.found", {
                          domain: normalizedUrl
                            ? getDomainLabel(normalizedUrl)
                            : "",
                        })
                      : t("Logo.notFound")}
                </p>
              </div>
              {isResolvingLogo ? (
                <div className="flex items-center justify-center py-6">
                  <div className="bg-muted flex size-24 items-center justify-center rounded-2xl">
                    <Loader2 className="text-muted-foreground size-6 animate-spin" />
                  </div>
                </div>
              ) : (
                <div className="flex justify-center">
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
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Brand Guidelines */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="space-y-1.5 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <h2 className="text-xl font-semibold tracking-tight">
                    {t("Brand.title")}
                  </h2>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={t("Brand.title")}
                      >
                        <Info className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-center">
                      {t("Brand.tooltip")}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-muted-foreground text-sm">
                  {t("Brand.subtitle")}
                </p>
              </div>

              <div className="flex flex-col items-center gap-4 py-4">
                {brand.status === "failed" ? (
                  <>
                    <div className="bg-muted flex size-16 items-center justify-center rounded-2xl">
                      <Sparkles className="text-muted-foreground size-6" />
                    </div>
                    <div className="space-y-1 text-center">
                      <p className="text-sm font-medium">
                        {t("Brand.failedTitle")}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t("Brand.failedSubtitle")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
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
                  </>
                ) : brand.status === "completed" ? (
                  <>
                    <div className="bg-primary/10 flex size-16 items-center justify-center rounded-2xl">
                      <Check className="text-primary size-7" />
                    </div>
                    <p className="text-sm font-medium">
                      {t("Brand.generated")}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="bg-muted relative flex size-16 items-center justify-center rounded-2xl">
                      <Sparkles className="text-primary size-6 animate-pulse" />
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {t("Brand.generating")}
                    </p>
                    <p className="text-muted-foreground/70 text-xs">
                      {t("Brand.skipHint")}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Step 3 — Invite */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="space-y-1.5 text-center">
                <h2 className="text-xl font-semibold tracking-tight">
                  {t("Invite.title")}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t("Invite.subtitle")}
                </p>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium">
                  {t("Invite.linkLabel")}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={
                      isCreatingLink
                        ? t("Invite.creatingLink")
                        : (inviteLink ?? "")
                    }
                    className="text-muted-foreground font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={!inviteLink || isCreatingLink}
                    onClick={() => void handleCopyLink()}
                    aria-label={copied ? t("Invite.copied") : t("Invite.copy")}
                  >
                    {copied ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("Invite.linkHint")}
                </p>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium">
                  {t("Invite.emailsLabel")}
                </span>
                <Textarea
                  rows={3}
                  value={emails}
                  onChange={(event) => setEmails(event.target.value)}
                  placeholder={t("Invite.emailsPlaceholder")}
                  className="resize-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-muted-foreground text-xs">
                    {t("Invite.emailsHint")}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
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
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between border-t px-6 py-4">
          {step > 0 ? (
            <Button
              variant="ghost"
              onClick={() => setStep((current) => current - 1)}
              disabled={isBusy}
            >
              <ArrowLeft className="size-4" />
              {t("Nav.back")}
            </Button>
          ) : (
            <div />
          )}

          {step === 0 && (
            <Button
              type="submit"
              form="create-org-details"
              variant="primary"
              disabled={isBusy}
            >
              {isCreatingOrg && <Loader2 className="size-4 animate-spin" />}
              {isCreatingOrg ? t("Nav.creating") : t("Nav.next")}
              {!isCreatingOrg && <ArrowRight className="size-4" />}
            </Button>
          )}
          {(step === 1 || step === 2) && (
            <Button
              variant="primary"
              onClick={() => setStep((current) => current + 1)}
              disabled={isBusy}
            >
              {t("Nav.next")}
              <ArrowRight className="size-4" />
            </Button>
          )}
          {step === 3 && (
            <Button variant="primary" onClick={handleFinish}>
              {t("Nav.finish")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
