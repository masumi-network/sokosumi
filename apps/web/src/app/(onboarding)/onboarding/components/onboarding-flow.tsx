"use client";

import type {
  OnboardingCompanySize,
  OnboardingCompanyType,
  OnboardingRole,
  OnboardingWorkStyle,
  PaidSubscriptionPlanName,
} from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { PaidSubscriptionPlanView } from "@/components/billing/subscription-plan-utils";
import {
  CREATE_ORGANIZATION_DETAILS_FORM_ID,
  CREATE_ORGANIZATION_SUCCESS_STEP,
  CreateOrganizationStep,
  useCreateOrganizationFlow,
} from "@/components/organizations/create-organization-wizard";
import { Button } from "@/components/ui/button";
import {
  acceptOrganizationInviteLink,
  CommonErrorCode,
  resolveOrganizationInviteLinkPreview,
} from "@/lib/actions";
import { completeOnboarding } from "@/lib/actions/onboarding";
import {
  upgradeOrganizationSubscription,
  upgradePersonalSubscription,
} from "@/lib/actions/subscription";
import { cn } from "@/lib/utils";
import {
  type OnboardingPreviewState,
  OnboardingPreviewToolbar,
} from "./onboarding-preview-toolbar";
import {
  EMPTY_ONBOARDING_ANSWERS,
  type OnboardingAnswers,
  type OnboardingStepId,
  type OnboardingTeamPath,
  type OnboardingVariant,
  resolveOnboardingSteps,
} from "./onboarding-steps";
import {
  type OnboardingOrganizationContext,
  PlanStep,
  resolveInitialOnboardingSeats,
} from "./steps/plan-step";
import {
  CompanySizeStep,
  CompanyTypeStep,
  RoleStep,
} from "./steps/profile-steps";
import {
  InviteLinkJoinButton,
  type InviteLinkPreviewState,
  InviteLinkStep,
  TeamChoiceStep,
  WorkStyleStep,
} from "./steps/team-steps";
import { type OnboardingCoworker, WelcomeStep } from "./steps/welcome-step";

const DEFAULT_SELECTED_PLAN: PaidSubscriptionPlanName = "standard";
const SUBSCRIPTION_RETURN_PATH = "/tasks?onboarding_subscription=1";
const INVITE_RESOLVE_DEBOUNCE_MS = 450;

interface OnboardingFlowProps {
  coworkers: OnboardingCoworker[];
  isPreview: boolean;
  paidPlans: PaidSubscriptionPlanView[];
  userName: null | string;
  variant: OnboardingVariant;
}

function resolveInitialSelectedPlan(
  paidPlans: PaidSubscriptionPlanView[],
): PaidSubscriptionPlanName {
  const selectablePlans = paidPlans.filter((plan) => !plan.isCurrent);
  const preferredPlan = selectablePlans.find(
    (plan) => plan.name === DEFAULT_SELECTED_PLAN,
  );

  return preferredPlan?.name ?? selectablePlans[0]?.name ?? "starter";
}

export function OnboardingFlow({
  coworkers,
  isPreview,
  paidPlans,
  userName,
  variant: initialVariant,
}: OnboardingFlowProps) {
  const t = useTranslations("Onboarding.Flow");
  const tErrors = useTranslations("Onboarding.Actions.Errors");
  const tSubscriptions = useTranslations("App.Subscriptions");
  const tOrganizationSubscriptions = useTranslations(
    "App.Organizations.OrganizationDetail.Subscription",
  );
  const router = useRouter();

  const [variant, setVariant] = useState<OnboardingVariant>(initialVariant);
  const [answers, setAnswers] = useState<OnboardingAnswers>(
    EMPTY_ONBOARDING_ANSWERS,
  );
  const [teamPath, setTeamPath] = useState<null | OnboardingTeamPath>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [isFinishing, setIsFinishing] = useState(false);

  const [inviteValue, setInviteValue] = useState("");
  const [invitePreview, setInvitePreview] =
    useState<InviteLinkPreviewState | null>(null);
  const [inviteToken, setInviteToken] = useState<null | string>(null);
  const [inviteError, setInviteError] = useState<null | string>(null);
  const [isResolvingInvite, setIsResolvingInvite] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [hasJoinedOrganization, setHasJoinedOrganization] = useState(false);
  /**
   * True while the invite preview came from the dev toolbar rather than a real
   * lookup, so the resolver does not immediately overwrite it with a
   * "not found" for the sample token.
   */
  const [isInvitePreviewSeeded, setIsInvitePreviewSeeded] = useState(false);

  const [selectedPlan, setSelectedPlan] = useState<PaidSubscriptionPlanName>(
    () => resolveInitialSelectedPlan(paidPlans),
  );
  const [targetSeats, setTargetSeats] = useState(() =>
    resolveInitialOnboardingSeats(1),
  );

  const organizationFlow = useCreateOrganizationFlow();

  const steps = useMemo(
    () =>
      resolveOnboardingSteps({
        answers,
        hasJoinedOrganization,
        teamPath,
        variant,
      }),
    [answers, hasJoinedOrganization, teamPath, variant],
  );

  // A branch change can shorten the sequence out from under the cursor (e.g.
  // switching from "team" back to "solo" on an earlier step).
  const safeStepIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep: OnboardingStepId = steps[safeStepIndex] ?? "welcome";

  const createdOrganization = useMemo<OnboardingOrganizationContext | null>(
    () =>
      organizationFlow.organizationId
        ? {
            id: organizationFlow.organizationId,
            memberCount: 1,
            name: organizationFlow.organizationName,
          }
        : null,
    [organizationFlow.organizationId, organizationFlow.organizationName],
  );

  const applyAnswer = useCallback((patch: Partial<OnboardingAnswers>) => {
    setAnswers((current) => ({ ...current, ...patch }));
  }, []);

  /* ── Invite link resolution ── */

  useEffect(() => {
    if (
      currentStep !== "inviteLink" ||
      hasJoinedOrganization ||
      isInvitePreviewSeeded
    ) {
      return;
    }

    const trimmedValue = inviteValue.trim();
    if (!trimmedValue) {
      setInvitePreview(null);
      setInviteToken(null);
      setInviteError(null);
      return;
    }

    let isActive = true;
    setIsResolvingInvite(true);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await resolveOrganizationInviteLinkPreview({
            tokenOrUrl: trimmedValue,
          });
          if (!isActive) return;

          if (!result.ok) {
            setInvitePreview(null);
            setInviteToken(null);
            setInviteError(t("InviteLink.Errors.invalid"));
            return;
          }

          if (result.data.status !== "valid" || !result.data.organization) {
            setInvitePreview(null);
            setInviteToken(null);
            setInviteError(t(`InviteLink.Errors.${result.data.status}`));
            return;
          }

          setInvitePreview({
            logo: result.data.organization.logo,
            name: result.data.organization.name,
          });
          setInviteToken(result.data.token);
          setInviteError(null);
        } finally {
          if (isActive) {
            setIsResolvingInvite(false);
          }
        }
      })();
    }, INVITE_RESOLVE_DEBOUNCE_MS);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [
    currentStep,
    hasJoinedOrganization,
    inviteValue,
    isInvitePreviewSeeded,
    t,
  ]);

  /** Typing replaces a seeded preview with a real lookup. */
  const handleInviteValueChange = useCallback((value: string) => {
    setIsInvitePreviewSeeded(false);
    setInviteValue(value);
  }, []);

  /* ── Completion ── */

  const finishOnboarding = useCallback(
    async (eventName: string): Promise<boolean> => {
      track(eventName, {
        companySize: answers.companySize ?? "",
        companyType: answers.companyType ?? "",
        role: answers.role ?? "",
        workStyle: answers.workStyle ?? "",
      });

      const result = await completeOnboarding({
        companySize: answers.companySize,
        companyType: answers.companyType,
        role: answers.role,
        workStyle: answers.workStyle,
      });

      if (!result.ok) {
        toast.error(result.error.message ?? tErrors("failedToComplete"));
        return false;
      }

      return true;
    },
    [answers, tErrors],
  );

  const handleFinish = useCallback(
    async (eventName: string) => {
      setIsFinishing(true);
      try {
        const completed = await finishOnboarding(eventName);
        if (completed) {
          router.push("/tasks");
        }
      } catch {
        toast.error(tErrors("unexpectedError"));
      } finally {
        setIsFinishing(false);
      }
    },
    [finishOnboarding, router, tErrors],
  );

  const handleJoinOrganization = useCallback(async () => {
    if (!inviteToken || isJoining) return;
    setIsJoining(true);
    try {
      const result = await acceptOrganizationInviteLink({ token: inviteToken });
      if (!result.ok) {
        toast.error(result.error.message ?? t("InviteLink.Errors.joinFailed"));
        return;
      }

      setHasJoinedOrganization(true);
      track("Onboarding joined organization");

      const completed = await finishOnboarding("Onboarding completed");
      if (completed) {
        router.push("/tasks");
      }
    } catch (error) {
      console.error("Failed to join organization", error);
      toast.error(t("InviteLink.Errors.joinFailed"));
    } finally {
      setIsJoining(false);
    }
  }, [finishOnboarding, inviteToken, isJoining, router, t]);

  const handleSubscribe = useCallback(async () => {
    setIsFinishing(true);
    try {
      // Complete first: the user has answered everything, and abandoning
      // Stripe must not drop their answers or trap them back in the flow.
      const completed = await finishOnboarding("Onboarding plan selected");
      if (!completed) {
        return;
      }

      const result = createdOrganization
        ? await upgradeOrganizationSubscription({
            organizationId: createdOrganization.id,
            plan: selectedPlan,
            returnPath: SUBSCRIPTION_RETURN_PATH,
            seats: targetSeats,
          })
        : await upgradePersonalSubscription({
            plan: selectedPlan,
            returnPath: SUBSCRIPTION_RETURN_PATH,
          });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.UNAUTHENTICATED) {
          toast.error(tSubscriptions("Errors.unauthenticated"), {
            action: {
              label: tSubscriptions("Errors.unauthenticatedAction"),
              onClick: () => router.push("/login"),
            },
          });
          return;
        }

        toast.error(
          result.error.message ??
            (createdOrganization
              ? tOrganizationSubscriptions("Errors.general")
              : tSubscriptions("Errors.general")),
        );
        return;
      }

      if (result.data.mode === "redirect") {
        window.location.href = result.data.url;
        return;
      }

      toast.success(tSubscriptions("statusSuccess"));
      router.push("/tasks");
    } catch {
      toast.error(tErrors("unexpectedError"));
    } finally {
      setIsFinishing(false);
    }
  }, [
    createdOrganization,
    finishOnboarding,
    router,
    selectedPlan,
    targetSeats,
    tErrors,
    tOrganizationSubscriptions,
    tSubscriptions,
  ]);

  /* ── Navigation ── */

  const isLastStep = safeStepIndex === steps.length - 1;

  const goNext = useCallback(() => {
    setStepIndex((current) => current + 1);
  }, []);

  const goBack = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  const canAdvance = useMemo(() => {
    switch (currentStep) {
      case "companyType":
        return answers.companyType !== null;
      case "companySize":
        return answers.companySize !== null;
      case "role":
        return answers.role !== null;
      case "workStyle":
        return answers.workStyle !== null;
      case "teamChoice":
        return teamPath !== null;
      default:
        return true;
    }
  }, [answers, currentStep, teamPath]);

  /* ── Preview overrides ── */

  const applyPreviewState = useCallback(
    (preview: OnboardingPreviewState) => {
      setVariant(preview.variant);
      setAnswers(preview.answers);
      setTeamPath(preview.teamPath);
      setHasJoinedOrganization(preview.hasJoinedOrganization);
      setInvitePreview(preview.invitePreview);
      setInviteToken(preview.invitePreview ? "preview-token" : null);
      setInviteError(null);
      setInviteValue(preview.invitePreview ? preview.inviteValue : "");
      setIsInvitePreviewSeeded(Boolean(preview.invitePreview));

      const nextSteps = resolveOnboardingSteps({
        answers: preview.answers,
        hasJoinedOrganization: preview.hasJoinedOrganization,
        teamPath: preview.teamPath,
        variant: preview.variant,
      });
      const nextIndex = nextSteps.indexOf(preview.stepId);
      setStepIndex(nextIndex === -1 ? 0 : nextIndex);

      if (preview.stepId === "createOrganization") {
        organizationFlow.setStep(preview.createOrganizationStep);
      }
    },
    [organizationFlow],
  );

  /* ── Rendering ── */

  function renderStep() {
    switch (currentStep) {
      case "welcome":
        return <WelcomeStep coworkers={coworkers} userName={userName} />;
      case "companyType":
        return (
          <CompanyTypeStep
            companyType={answers.companyType}
            onCompanyTypeChange={(companyType: OnboardingCompanyType) =>
              applyAnswer({ companyType })
            }
          />
        );
      case "companySize":
        return (
          <CompanySizeStep
            companySize={answers.companySize}
            onCompanySizeChange={(companySize: OnboardingCompanySize) =>
              applyAnswer({ companySize })
            }
          />
        );
      case "role":
        return (
          <RoleStep
            onRoleChange={(role: OnboardingRole) => applyAnswer({ role })}
            role={answers.role}
          />
        );
      case "workStyle":
        return (
          <WorkStyleStep
            onWorkStyleChange={(workStyle: OnboardingWorkStyle) =>
              applyAnswer({ workStyle })
            }
            workStyle={answers.workStyle}
          />
        );
      case "teamChoice":
        return (
          <TeamChoiceStep onTeamPathChange={setTeamPath} teamPath={teamPath} />
        );
      case "inviteLink":
        return (
          <InviteLinkStep
            errorMessage={inviteError}
            hasJoined={hasJoinedOrganization}
            isResolving={isResolvingInvite}
            onValueChange={handleInviteValueChange}
            preview={invitePreview}
            value={inviteValue}
          />
        );
      case "createOrganization":
        return <CreateOrganizationStep flow={organizationFlow} />;
      case "plan":
        return (
          <PlanStep
            onSelectedPlanChange={setSelectedPlan}
            onTargetSeatsChange={setTargetSeats}
            organization={createdOrganization}
            plans={paidPlans}
            selectedPlan={selectedPlan}
            targetSeats={targetSeats}
          />
        );
      default:
        return null;
    }
  }

  function renderPrimaryAction() {
    // Joining normally completes onboarding and navigates away. If that last
    // step failed, the user is still a member — offer the finish action again
    // rather than a "Join" button that would re-run the accept.
    if (currentStep === "inviteLink" && !hasJoinedOrganization) {
      return (
        <InviteLinkJoinButton
          // Nothing to join until a link actually resolves to a team.
          isDisabled={!inviteToken || !invitePreview}
          isJoining={isJoining || isFinishing}
          onJoin={() => void handleJoinOrganization()}
          organizationName={invitePreview?.name ?? ""}
        />
      );
    }

    if (currentStep === "createOrganization") {
      return renderCreateOrganizationAction();
    }

    if (currentStep === "plan") {
      return (
        <Button
          variant="primary"
          size="lg"
          className="h-11 px-6"
          disabled={isFinishing}
          onClick={() => void handleSubscribe()}
        >
          {isFinishing && <Loader2 className="size-4 animate-spin" />}
          {t("Nav.subscribe")}
        </Button>
      );
    }

    if (isLastStep) {
      return (
        <Button
          variant="primary"
          size="lg"
          className="h-11 px-6"
          disabled={!canAdvance || isFinishing}
          onClick={() => void handleFinish("Onboarding completed")}
        >
          {isFinishing && <Loader2 className="size-4 animate-spin" />}
          {t("Nav.finish")}
        </Button>
      );
    }

    return (
      <Button
        variant="primary"
        size="lg"
        className="h-11 px-6"
        disabled={!canAdvance}
        onClick={goNext}
      >
        {currentStep === "welcome" ? t("Nav.getStarted") : t("Nav.next")}
        <ArrowRight className="size-4" />
      </Button>
    );
  }

  /** Mirrors the wizard's own footer so the embedded steps behave identically. */
  function renderCreateOrganizationAction() {
    const { isBusy, isCreatingOrg, setStep, step } = organizationFlow;

    if (step === 0) {
      return (
        <Button
          type="submit"
          form={CREATE_ORGANIZATION_DETAILS_FORM_ID}
          variant="primary"
          size="lg"
          className="h-11 px-6"
          disabled={isBusy}
        >
          {isCreatingOrg && <Loader2 className="size-4 animate-spin" />}
          {isCreatingOrg ? t("Nav.creating") : t("Nav.next")}
          {!isCreatingOrg && <ArrowRight className="size-4" />}
        </Button>
      );
    }

    if (step === CREATE_ORGANIZATION_SUCCESS_STEP) {
      return (
        <Button
          variant="primary"
          size="lg"
          className="h-11 px-6"
          disabled={isBusy}
          onClick={goNext}
        >
          {t("Nav.next")}
          <ArrowRight className="size-4" />
        </Button>
      );
    }

    return (
      <Button
        variant="primary"
        size="lg"
        className="h-11 px-6"
        disabled={isBusy}
        onClick={() => setStep((current) => current + 1)}
      >
        {step === 2 ? t("Nav.finishSetup") : t("Nav.next")}
        {step !== 2 && <ArrowRight className="size-4" />}
      </Button>
    );
  }

  function renderBackAction() {
    if (safeStepIndex === 0) {
      return <div />;
    }

    // Inside the org wizard, "Back" walks its own steps first. Past the point
    // where the organization exists it disappears: there is nothing left to
    // reconfigure and stepping back would imply the creation can be undone.
    if (currentStep === "createOrganization") {
      const { organizationId, step } = organizationFlow;
      if (step >= CREATE_ORGANIZATION_SUCCESS_STEP || organizationId) {
        return <div />;
      }
      if (step > 0) {
        return (
          <Button
            variant="ghost"
            className="text-muted-foreground h-11 px-4"
            disabled={organizationFlow.isBusy}
            onClick={() => organizationFlow.setStep((current) => current - 1)}
          >
            <ArrowLeft className="size-4" />
            {t("Nav.back")}
          </Button>
        );
      }
    }

    if (currentStep === "inviteLink" && hasJoinedOrganization) {
      return <div />;
    }

    return (
      <Button
        variant="ghost"
        className="text-muted-foreground h-11 px-4"
        disabled={isFinishing || isJoining}
        onClick={goBack}
      >
        <ArrowLeft className="size-4" />
        {t("Nav.back")}
      </Button>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Stage — `m-auto` on the child, not `justify-center` on the scroller:
          a centered flex child that outgrows its container gets clipped at the
          top with no way to scroll back up. */}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-6 sm:px-10">
        <div
          key={`${currentStep}-${organizationFlow.step}`}
          className={cn(
            "animate-in fade-in-0 slide-in-from-bottom-1 my-auto flex w-full flex-col items-center text-center duration-200 ease-out motion-reduce:animate-none",
            // Pricing needs three columns; every other screen is one question
            // in the wizard's narrow column.
            currentStep === "plan" ? "max-w-5xl" : "max-w-2xl",
          )}
        >
          {renderStep()}
        </div>
      </div>

      {/* Footer — exactly one filled action on screen */}
      <div className="bg-background flex shrink-0 items-center justify-between gap-3 border-t px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-6 sm:pb-6">
        {renderBackAction()}
        <div className="flex items-center gap-2">
          {currentStep === "plan" ? (
            <Button
              variant="ghost"
              className="text-muted-foreground h-11 px-4"
              disabled={isFinishing}
              onClick={() => void handleFinish("Onboarding plan skipped")}
            >
              {t("Nav.skipPlan")}
            </Button>
          ) : null}
          {renderPrimaryAction()}
        </div>
      </div>

      {isPreview ? (
        <OnboardingPreviewToolbar
          answers={answers}
          createOrganizationStep={organizationFlow.step}
          hasJoinedOrganization={hasJoinedOrganization}
          inviteValue={inviteValue}
          invitePreview={invitePreview}
          onApply={applyPreviewState}
          stepId={currentStep}
          teamPath={teamPath}
          variant={variant}
        />
      ) : null}
    </div>
  );
}
