"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  buildOrganizationMetadataWithUrl,
  normalizeWebsiteUrl,
} from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import {
  DESIGN_MD_TRANSLATION_NAMESPACE,
  type DesignMdOwner,
  useDesignMdGeneration,
} from "@/components/design-md";
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
  cleanupOrganizationLogoBestEffort,
  getOrganizationLogoUploadErrorMessage,
  uploadOrganizationLogoDirect,
} from "@/lib/utils/organization-logo-upload.client";
import {
  ClientTimeoutError,
  raceWithTimeout,
} from "@/lib/utils/race-with-timeout";

export const CREATE_ORGANIZATION_TOTAL_STEPS = 4;
/**
 * Index of the terminal step. Setup ends with the brand guidelines; this step
 * only confirms the result and offers invites, so it has no way back.
 */
export const CREATE_ORGANIZATION_SUCCESS_STEP = 3;
export const CREATE_ORGANIZATION_TRANSLATION_NAMESPACE =
  "Components.Organizations.CreateOrganizationWizard";

const COPIED_RESET_MS = 2000;

export interface CreateOrganizationDetailsValues {
  name: string;
  url: string;
}

function getDomainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Everything the create-organization flow does, independent of the surface it
 * renders on. The wizard dialog and the signup onboarding page both drive it,
 * so the steps behave identically in either host.
 */
export function useCreateOrganizationFlow() {
  const t = useTranslations(CREATE_ORGANIZATION_TRANSLATION_NAMESPACE);
  const tDesignMd = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);
  const router = useRouter();
  const { handleSelectWorkspace } = useWorkspaceSwitcher();

  const [step, setStep] = useState(0);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [normalizedUrl, setNormalizedUrl] = useState<string | null>(null);
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);

  const [logoUrl, setLogoUrl] = useState("");
  const logoUrlRef = useRef(logoUrl);
  logoUrlRef.current = logoUrl;
  const [isResolvingLogo, setIsResolvingLogo] = useState(false);
  const [pendingLogoFiles, setPendingLogoFiles] = useState<File[]>([]);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
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

  const form = useForm<CreateOrganizationDetailsValues>({
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
    setLinkFailed(false);
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

  const persistLogo = useCallback(
    async (nextLogo: string | null, previousLogo?: string) => {
      if (!organizationId) return;
      await authClient.organization.update({
        organizationId,
        data: { logo: nextLogo },
      });
      if (previousLogo && previousLogo !== nextLogo) {
        void cleanupOrganizationLogoBestEffort(organizationId, previousLogo);
      }
    },
    [organizationId],
  );

  const resolveLogoFromWebsite = useCallback(
    async (orgId: string, url: string) => {
      setIsResolvingLogo(true);
      try {
        const result = await resolveOrganizationSiteIcon({
          url,
          organizationId: orgId,
        });
        if (result.ok && result.value.url) {
          const previousLogo = logoUrlRef.current;
          setLogoUrl(result.value.url);
          await authClient.organization.update({
            organizationId: orgId,
            data: { logo: result.value.url },
          });
          if (previousLogo && previousLogo !== result.value.url) {
            void cleanupOrganizationLogoBestEffort(orgId, previousLogo);
          }
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
        slug: slugResult.value,
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
      setOrganizationName(values.name);
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

  // Step 3 — mint the shareable invite link once (retry via button on failure).
  const mintInviteLink = useCallback(async () => {
    if (!organizationId) return;
    setIsCreatingLink(true);
    setLinkFailed(false);
    try {
      const result = await createOrganizationInviteLink({
        organizationId,
      });
      if (result.ok) {
        setInviteLink(result.value.url);
      } else {
        setLinkFailed(true);
        toast.error(t("Invite.linkError"));
      }
    } catch (error) {
      console.error("Failed to create invite link", error);
      setLinkFailed(true);
      toast.error(t("Invite.linkError"));
    } finally {
      setIsCreatingLink(false);
    }
  }, [organizationId, t]);

  useEffect(() => {
    if (
      step === CREATE_ORGANIZATION_SUCCESS_STEP &&
      organizationId &&
      !linkStartedRef.current
    ) {
      linkStartedRef.current = true;
      void mintInviteLink();
    }
  }, [step, organizationId, mintInviteLink]);

  const handleLogoUpload = useCallback(
    async (files: File[]) => {
      const logoFile = files[0];
      if (!logoFile || !organizationId) return;
      setIsUploadingLogo(true);
      const previousLogo = logoUrl;
      try {
        const uploaded = await raceWithTimeout(
          uploadOrganizationLogoDirect(organizationId, logoFile, {
            allowedContentTypes: [...ORGANIZATION_LOGO_ALLOWED_MIME_TYPES],
            maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
          }),
          ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
        );
        setLogoUrl(uploaded.publicUrl);
        await persistLogo(uploaded.publicUrl, previousLogo);
      } catch (error) {
        toast.error(
          error instanceof ClientTimeoutError
            ? t("Logo.uploadError")
            : getOrganizationLogoUploadErrorMessage(
                error,
                t("Logo.uploadError"),
              ),
        );
      } finally {
        setPendingLogoFiles([]);
        setIsUploadingLogo(false);
      }
    },
    [logoUrl, organizationId, persistLogo, t],
  );

  const handleRemoveLogo = useCallback(() => {
    const previousLogo = logoUrl;
    setLogoUrl("");
    setPendingLogoFiles([]);
    // Optimistic, so a rejected write has to put the logo back — otherwise the
    // UI says removed while the server still serves it, with nothing said.
    void persistLogo(null, previousLogo).catch((error) => {
      console.error("Failed to remove organization logo", error);
      setLogoUrl(previousLogo);
      toast.error(t("Logo.uploadError"));
    });
  }, [logoUrl, persistLogo, t]);

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
      const sent = result.value.results.filter(
        (row) => row.status === "sent",
      ).length;
      const failed = result.value.results.length - sent;
      toast.success(t("Invite.inviteSummary", { sent, failed }));
      setEmails("");
    } catch (error) {
      console.error("Failed to send invites", error);
      toast.error(t("Invite.emailError"));
    } finally {
      setIsSendingInvites(false);
    }
  }, [organizationId, emails, t]);

  /** Switches the session into the organization the flow just created. */
  const activateWorkspace = useCallback(() => {
    if (!organizationId) return;
    void handleSelectWorkspace(organizationId, {
      shouldRedirectAgentJobsBasePath: false,
    });
  }, [handleSelectWorkspace, organizationId]);

  const isBusy = isCreatingOrg || isUploadingLogo;
  const brandDomain = normalizedUrl ? getDomainLabel(normalizedUrl) : "";

  return {
    activateWorkspace,
    brand,
    brandDomain,
    copied,
    emails,
    form,
    handleCopyLink,
    handleDetailsContinue,
    handleLogoUpload,
    handleRemoveLogo,
    handleSendInvites,
    inviteLink,
    isBusy,
    isCreatingLink,
    isCreatingOrg,
    isResolvingLogo,
    isSendingInvites,
    isUploadingLogo,
    linkFailed,
    logoUrl,
    mintInviteLink,
    normalizedUrl,
    organizationId,
    organizationName,
    pendingLogoFiles,
    resetAll,
    setEmails,
    setPendingLogoFiles,
    setStep,
    step,
  };
}

export type CreateOrganizationFlow = ReturnType<
  typeof useCreateOrganizationFlow
>;
