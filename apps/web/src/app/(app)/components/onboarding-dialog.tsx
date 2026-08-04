"use client";

import type { PaidSubscriptionPlanName } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { ArrowLeft, ArrowRight, Bot } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import {
  OrganizationSeatSettingsFields,
  resolveMinimumOrganizationSeats,
  resolveTargetOrganizationSeats,
} from "@/components/billing/organization-seat-settings-fields";
import type { PaidSubscriptionPlanView } from "@/components/billing/subscription-plan-utils";
import { SokosumiIcon } from "@/components/masumi-logos";
import { OnboardingPlanRadioGrid } from "@/components/onboarding/onboarding-plan-radio-grid";
import { TaskboardVisual } from "@/components/onboarding/taskboard-visual";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCoworkersContext } from "@/contexts/coworkers-context";
import { CommonErrorCode } from "@/lib/actions";
import { completeOnboarding } from "@/lib/actions/onboarding";
import {
  upgradeOrganizationSubscription,
  upgradePersonalSubscription,
} from "@/lib/actions/subscription";
import { markSubscriptionOnboardingGateSeenSafely } from "@/lib/onboarding/mark-subscription-onboarding-gate-seen.client";

const INTRO_STEP_COUNT = 5;
const DEFAULT_SELECTED_PLAN: PaidSubscriptionPlanName = "standard";
const SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY =
  "sokosumi.onboarding.subscription.lastLoginId";

export type OnboardingSubscriptionCheckoutMode =
  | "organization"
  | "personal"
  | "restricted";

function readLastSubscriptionOnboardingLoginId(): null | string {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const loginId = window.localStorage.getItem(
      SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
    );
    return loginId ? loginId : null;
  } catch {
    return null;
  }
}

function writeLastSubscriptionOnboardingLoginId(loginId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
      loginId,
    );
  } catch {
    // Ignore localStorage write errors (quota, privacy mode, etc.).
  }
}

function shouldOpenSubscriptionOnlyOnboarding(
  loginId?: null | string,
): boolean {
  if (!loginId) {
    return true;
  }

  return readLastSubscriptionOnboardingLoginId() !== loginId;
}

/* ─── Animated visuals ─── */

interface ChatVisualProps {
  avatarAlt: string;
  avatarUrl: string;
  userMessage: string;
  coworkerReply: string;
}

function ChatVisual({
  avatarAlt,
  avatarUrl,
  userMessage,
  coworkerReply,
}: ChatVisualProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 2200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex h-full flex-col justify-center px-8">
      <div className="space-y-3">
        {/* User message */}
        <div
          className={`flex justify-end transition-all duration-500 ${
            phase >= 1 ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
          }`}
        >
          <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-[13px]">
            {userMessage}
          </div>
        </div>

        {/* Typing indicator */}
        {phase === 2 && (
          <div className="flex items-end gap-2">
            <div className="relative size-6 shrink-0 overflow-hidden rounded-full">
              <Image
                src={avatarUrl}
                alt={avatarAlt}
                fill
                className="object-cover"
              />
            </div>
            <div className="bg-background flex gap-1 rounded-2xl rounded-bl-sm border px-4 py-3">
              <span className="bg-muted-foreground/40 size-1.5 animate-bounce rounded-full [animation-delay:0ms]" />
              <span className="bg-muted-foreground/40 size-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
              <span className="bg-muted-foreground/40 size-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {/* Coworker response */}
        <div
          className={`flex items-end gap-2 transition-all duration-500 ${
            phase >= 3 ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
          }`}
        >
          <div className="relative size-6 shrink-0 overflow-hidden rounded-full">
            <Image
              src={avatarUrl}
              alt={avatarAlt}
              fill
              className="object-cover"
            />
          </div>
          <div className="bg-background max-w-[85%] rounded-2xl rounded-bl-sm border px-4 py-2.5 text-[13px]">
            {coworkerReply}
          </div>
        </div>
      </div>
    </div>
  );
}

interface OrchestrationVisualProps {
  avatarAlt: string;
  avatarUrl: string;
  coworkerName: string;
  agents: string[];
  hiresLabel: string;
  workDeliveredLabel: string;
}

function OrchestrationVisual({
  avatarAlt,
  avatarUrl,
  coworkerName,
  agents,
  hiresLabel,
  workDeliveredLabel,
}: OrchestrationVisualProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1100),
      setTimeout(() => setPhase(4), 1400),
      setTimeout(() => setPhase(5), 1700),
      setTimeout(() => setPhase(6), 2500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6">
      <div className="flex items-center gap-4">
        {/* Coworker node */}
        <div
          className={`flex flex-col items-center gap-1.5 transition-all duration-500 ${
            phase >= 1 ? "scale-100 opacity-100" : "scale-90 opacity-0"
          }`}
        >
          <div className="ring-primary/20 relative size-14 overflow-hidden rounded-full ring-2">
            <Image
              src={avatarUrl}
              alt={avatarAlt}
              fill
              className="object-cover"
            />
          </div>
          <span className="text-xs font-medium">{coworkerName}</span>
        </div>

        {/* Connection */}
        <div
          className={`flex flex-col items-center gap-1 transition-all duration-500 ${
            phase >= 2 ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="bg-border relative h-px w-16">
            <span className="bg-primary absolute top-1/2 left-0 size-1.5 -translate-y-1/2 animate-[slide_2s_ease-in-out_infinite] rounded-full" />
          </div>
          <span className="text-muted-foreground text-[10px]">
            {hiresLabel}
          </span>
        </div>

        {/* Agent nodes */}
        <div className="flex flex-col gap-2">
          {agents.map((name, i) => (
            <div
              key={name}
              className={`flex items-center gap-2 transition-all duration-500 ${
                phase >= 3 + i
                  ? "translate-x-0 opacity-100"
                  : "-translate-x-2 opacity-0"
              }`}
            >
              <div className="bg-background flex size-8 items-center justify-center rounded-full border shadow-sm">
                <Bot className="text-muted-foreground size-3.5" />
              </div>
              <span className="text-muted-foreground text-[11px]">{name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Result badge */}
      <div
        className={`mt-6 flex items-center gap-2 transition-all duration-500 ${
          phase >= 6 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <div className="bg-border h-px w-6" />
        <div className="bg-primary/10 text-primary rounded-full px-3 py-1 text-[11px] font-medium">
          {workDeliveredLabel}
        </div>
        <div className="bg-border h-px w-6" />
      </div>
    </div>
  );
}

/* ─── Navigation ─── */

function StepNavigation({
  step,
  totalSteps,
  showBack,
  showSkip,
  labels,
  isLoading,
  onBack,
  onNext,
  onSkip,
  onFinish,
}: {
  step: number;
  totalSteps: number;
  showBack: boolean;
  showSkip: boolean;
  labels: {
    skip: string;
    back: string;
    next: string;
    finish: string;
  };
  isLoading: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const isFirst = step === 0;
  const isLast = step === totalSteps - 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span
            key={i}
            className={`size-1.5 rounded-full transition-colors ${
              i === step ? "bg-primary" : "bg-muted-foreground/25"
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        {showSkip ? (
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={onSkip}
            disabled={isLoading}
          >
            {labels.skip}
          </Button>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-3">
          {showBack ? (
            <Button
              variant="ghost"
              onClick={onBack}
              disabled={isFirst || isLoading}
            >
              <ArrowLeft className="size-4" />
              {labels.back}
            </Button>
          ) : null}
          {isLast ? (
            <Button variant="primary" onClick={onFinish} disabled={isLoading}>
              {labels.finish}
            </Button>
          ) : (
            <Button variant="primary" onClick={onNext} disabled={isLoading}>
              {labels.next}
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main dialog ─── */

interface OnboardingDialogProps {
  loginId?: null | string;
  organizationSubscription?: {
    assignedSeatCount: number;
    currentSeats: number;
    memberCount: number;
    organizationId: string;
  };
  paidPlans: PaidSubscriptionPlanView[];
  subscriptionCheckoutMode: OnboardingSubscriptionCheckoutMode;
  subscriptionOnly?: boolean;
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

export function OnboardingDialog({
  loginId,
  organizationSubscription,
  paidPlans,
  subscriptionCheckoutMode,
  subscriptionOnly = false,
}: OnboardingDialogProps) {
  const tMetadata = useTranslations("Onboarding.Metadata");
  const tDialog = useTranslations("Onboarding.Dialog");
  const tErrors = useTranslations("Onboarding.Actions.Errors");
  const tOrganizationSubscriptions = useTranslations(
    "App.Organizations.OrganizationDetail.Subscription",
  );
  const tSubscriptions = useTranslations("App.Subscriptions");
  const router = useRouter();
  const [open, setOpen] = useState(() => !subscriptionOnly);
  const [step, setStep] = useState(subscriptionOnly ? INTRO_STEP_COUNT - 1 : 0);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PaidSubscriptionPlanName>(
    () => resolveInitialSelectedPlan(paidPlans),
  );
  const [targetSeats, setTargetSeats] = useState(() =>
    organizationSubscription
      ? resolveTargetOrganizationSeats(
          organizationSubscription.currentSeats,
          organizationSubscription.assignedSeatCount,
        )
      : 1,
  );
  const { coworkers: apiCoworkers } = useCoworkersContext();
  const isRestrictedOrganizationGate =
    subscriptionOnly && subscriptionCheckoutMode === "restricted";

  useEffect(() => {
    if (!subscriptionOnly) {
      setOpen(true);
      return;
    }

    if (isRestrictedOrganizationGate) {
      setOpen(false);
      // Do not mark the session cookie: the user never saw a checkout-capable
      // gate. Marking would make AppLayout skip the loader for this session
      // everywhere (e.g. personal workspace) until the session changes.
      return;
    }

    if (!shouldOpenSubscriptionOnlyOnboarding(loginId)) {
      setOpen(false);
      if (loginId) {
        markSubscriptionOnboardingGateSeenSafely(loginId);
      }
      return;
    }

    // Skip cookie only after localStorage suppresses the gate — setting it on
    // first open refreshes RSC and unmounts this dialog.

    if (loginId) {
      writeLastSubscriptionOnboardingLoginId(loginId);
    }

    setOpen(true);
  }, [isRestrictedOrganizationGate, loginId, subscriptionOnly]);

  if (!open) return null;

  const defaultRole = tDialog("defaultRole");
  const coworkers = apiCoworkers.slice(0, 2).map((c) => ({
    name: c.name,
    role: c.caption ?? defaultRole,
    avatar:
      getCoworkerImageUrl(c.id, c.avatar ?? undefined) ??
      "/images/coworkers/elena.webp",
  }));

  const introSteps = [
    {
      title: tDialog("intro.welcome.title"),
      description: tDialog("intro.welcome.description"),
    },
    {
      title: tDialog("intro.chat.title"),
      description: tDialog("intro.chat.description"),
    },
    {
      title: tDialog("intro.taskboard.title"),
      description: tDialog("intro.taskboard.description"),
    },
    {
      title: tDialog("intro.orchestration.title"),
      description: tDialog("intro.orchestration.description"),
    },
    {
      title: tDialog("intro.plans.title"),
      description: tDialog("intro.plans.description"),
    },
  ];

  const handleComplete = async (eventName: string) => {
    track(eventName);
    setIsLoading(true);
    try {
      const result = await completeOnboarding();
      if (result.ok) {
        const redirectUrl = result.data.redirectUrl ?? "/agents";
        setOpen(false);
        router.push(redirectUrl);
      } else {
        toast.error(result.error.message ?? tErrors("failedToComplete"));
      }
    } catch {
      toast.error(tErrors("unexpectedError"));
    } finally {
      setIsLoading(false);
    }
  };

  function handleSubscriptionOnlySkip() {
    track("Onboarding skipped");
    if (loginId) {
      writeLastSubscriptionOnboardingLoginId(loginId);
      markSubscriptionOnboardingGateSeenSafely(loginId);
    }
    setOpen(false);
  }

  function handleSubscriptionActionError(
    error: { code: string; message?: string | null },
    options: {
      badInputMessage: string;
      generalMessage: string;
      unauthenticatedActionLabel: string;
      unauthenticatedMessage: string;
      unauthorizedMessage?: string;
    },
  ) {
    if (error.code === CommonErrorCode.UNAUTHENTICATED) {
      toast.error(options.unauthenticatedMessage, {
        action: {
          label: options.unauthenticatedActionLabel,
          onClick: () => {
            router.push("/login");
          },
        },
      });
      return;
    }

    if (error.message) {
      toast.error(error.message);
      return;
    }

    switch (error.code) {
      case CommonErrorCode.BAD_INPUT:
        toast.error(options.badInputMessage);
        break;
      case CommonErrorCode.UNAUTHORIZED:
        toast.error(options.unauthorizedMessage ?? options.generalMessage);
        break;
      default:
        toast.error(options.generalMessage);
        break;
    }
  }

  const handleStartSubscription = async () => {
    const organizationId = organizationSubscription?.organizationId;
    const minimumSeats = organizationSubscription
      ? resolveMinimumOrganizationSeats(
          organizationSubscription.assignedSeatCount,
        )
      : 1;

    if (
      organizationSubscription &&
      (!Number.isInteger(targetSeats) || targetSeats < minimumSeats)
    ) {
      toast.error(tOrganizationSubscriptions("Errors.badInput"));
      return;
    }

    track("Onboarding plan checkout started", {
      customerType: organizationId ? "organization" : "user",
      plan: selectedPlan,
      ...(organizationId ? { seats: targetSeats } : {}),
    });
    setIsLoading(true);

    try {
      const result = organizationId
        ? await upgradeOrganizationSubscription({
            organizationId,
            plan: selectedPlan,
            returnPath: "/tasks?onboarding_subscription=1",
            seats: targetSeats,
          })
        : await upgradePersonalSubscription({
            plan: selectedPlan,
            returnPath: "/tasks?onboarding_subscription=1",
          });

      if (!result.ok) {
        handleSubscriptionActionError(
          result.error,
          organizationId
            ? {
                badInputMessage: tOrganizationSubscriptions("Errors.badInput"),
                generalMessage: tOrganizationSubscriptions("Errors.general"),
                unauthenticatedActionLabel: tOrganizationSubscriptions(
                  "Errors.unauthenticatedAction",
                ),
                unauthenticatedMessage: tOrganizationSubscriptions(
                  "Errors.unauthenticated",
                ),
                unauthorizedMessage: tOrganizationSubscriptions(
                  "Errors.unauthorized",
                ),
              }
            : {
                badInputMessage: tSubscriptions("Errors.badInput"),
                generalMessage: tSubscriptions("Errors.general"),
                unauthenticatedActionLabel: tSubscriptions(
                  "Errors.unauthenticatedAction",
                ),
                unauthenticatedMessage: tSubscriptions(
                  "Errors.unauthenticated",
                ),
              },
        );
        return;
      }

      if (result.data.mode === "redirect") {
        window.location.href = result.data.url;
        return;
      }

      toast.success(tSubscriptions("statusSuccess"));
      await handleComplete("Onboarding subscription completed");
    } catch {
      toast.error(tErrors("unexpectedError"));
    } finally {
      setIsLoading(false);
    }
  };

  const isWelcome = step === 0;
  const isPlanStep = step === INTRO_STEP_COUNT - 1;
  const navigationStep = subscriptionOnly ? 0 : step;
  const navigationTotalSteps = subscriptionOnly ? 1 : INTRO_STEP_COUNT;
  const hasSplitLayout = !isWelcome && !isPlanStep;
  const firstCoworkerName = coworkers[0]?.name ?? "";
  const firstCoworkerAvatarUrl =
    coworkers[0]?.avatar ?? "/images/coworkers/elena.webp";
  const firstCoworkerAvatarAlt = tDialog("alt.coworkerAvatar", {
    name: firstCoworkerName,
  });

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-6xl! h-full md:h-auto overflow-hidden border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[90vw] [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="hidden">{tMetadata("title")}</DialogTitle>
        <DialogDescription className="hidden">
          {tMetadata("description")}
        </DialogDescription>

        <div className="bg-background flex max-h-svh flex-col overflow-hidden rounded-xl shadow-lg md:max-h-[85vh]">
          {/* Content area */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:overflow-hidden md:flex-row">
            {/* Visual panel — stacked on mobile, side panel on desktop */}
            {hasSplitLayout && (
              <div className="bg-muted flex h-44 shrink-0 border-b md:h-auto md:w-[42%] md:shrink md:border-r md:border-b-0">
                {step === 1 && (
                  <ChatVisual
                    avatarAlt={firstCoworkerAvatarAlt}
                    avatarUrl={firstCoworkerAvatarUrl}
                    userMessage={tDialog("visuals.chat.userMessage")}
                    coworkerReply={tDialog("visuals.chat.reply")}
                  />
                )}
                {step === 2 && (
                  <TaskboardVisual
                    avatarAlt={firstCoworkerAvatarAlt}
                    avatarUrl={firstCoworkerAvatarUrl}
                    coworkerName={firstCoworkerName}
                    taskTitle={tDialog("visuals.taskboard.taskTitle")}
                    todoLabel={tDialog("visuals.taskboard.todo")}
                    inProgressLabel={tDialog("visuals.taskboard.inProgress")}
                  />
                )}
                {step === 3 && (
                  <OrchestrationVisual
                    avatarAlt={firstCoworkerAvatarAlt}
                    avatarUrl={firstCoworkerAvatarUrl}
                    coworkerName={firstCoworkerName}
                    hiresLabel={tDialog("visuals.orchestration.hires")}
                    agents={[
                      tDialog("visuals.orchestration.agents.research"),
                      tDialog("visuals.orchestration.agents.writing"),
                      tDialog("visuals.orchestration.agents.analytics"),
                    ]}
                    workDeliveredLabel={tDialog(
                      "visuals.orchestration.workDelivered",
                    )}
                  />
                )}
              </div>
            )}

            {/* Main content */}
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center md:overflow-y-auto md:p-10">
              {/* Welcome */}
              {isWelcome && (
                <>
                  <SokosumiIcon
                    width={72}
                    height={72}
                    animated={false}
                    className="text-foreground"
                  />
                  <h2 className="mt-8 text-2xl font-semibold tracking-tight">
                    {introSteps[0].title}
                  </h2>
                  <p className="text-muted-foreground mt-3 max-w-md text-[15px] leading-relaxed">
                    {introSteps[0].description}
                  </p>
                  <div className="mt-8 flex items-center gap-3">
                    <div className="flex -space-x-2">
                      {coworkers.map((cw) => (
                        <Tooltip key={cw.name}>
                          <TooltipTrigger asChild>
                            <div className="ring-background relative size-8 overflow-hidden rounded-full ring-2">
                              <Image
                                src={cw.avatar}
                                alt={tDialog("alt.coworkerAvatar", {
                                  name: cw.name,
                                })}
                                fill
                                className="object-cover"
                              />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {tDialog("coworkerTooltip", {
                              name: cw.name,
                              role: cw.role,
                            })}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                    <span className="text-muted-foreground text-sm">
                      {tDialog("welcome.coworkersSummary", {
                        first: coworkers[0]?.name ?? "",
                        second: coworkers[1]?.name ?? "",
                      })}
                    </span>
                  </div>
                </>
              )}

              {/* Steps 1-3 text content */}
              {hasSplitLayout && (
                <div className="md:self-start md:text-left">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {introSteps[step].title}
                  </h2>
                  <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-[15px] leading-relaxed md:mx-0">
                    {introSteps[step].description}
                  </p>
                </div>
              )}

              {isPlanStep && (
                <div className="w-full max-w-5xl space-y-6 text-left">
                  <div className="space-y-3 text-center">
                    <h2 className="text-2xl font-semibold tracking-tight">
                      {introSteps[step].title}
                    </h2>
                    <p className="text-muted-foreground mx-auto max-w-2xl text-[15px] leading-relaxed">
                      {introSteps[step].description}
                    </p>
                  </div>
                  {organizationSubscription ? (
                    <div className="rounded-xl border p-4 md:p-6">
                      <OrganizationSeatSettingsFields
                        assignedSeatCount={
                          organizationSubscription.assignedSeatCount
                        }
                        inputId="onboarding-organization-seats"
                        memberCount={organizationSubscription.memberCount}
                        onTargetSeatsChange={setTargetSeats}
                        targetSeats={targetSeats}
                      />
                    </div>
                  ) : null}
                  <OnboardingPlanRadioGrid
                    plans={paidPlans}
                    value={selectedPlan}
                    onValueChange={setSelectedPlan}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Fixed bottom navigation */}
          <div className="shrink-0 border-t px-6 pt-4 pb-6 md:px-10 md:pt-5 md:pb-8">
            <StepNavigation
              step={navigationStep}
              totalSteps={navigationTotalSteps}
              showBack={!subscriptionOnly}
              showSkip
              labels={{
                skip: tDialog("navigation.skip"),
                back: tDialog("navigation.back"),
                next: tDialog("navigation.next"),
                finish: isPlanStep
                  ? tDialog("navigation.subscribe")
                  : tDialog("navigation.getStarted"),
              }}
              isLoading={isLoading}
              onBack={() => {
                if (subscriptionOnly) return;
                setStep((currentStep) => currentStep - 1);
              }}
              onNext={() => {
                if (subscriptionOnly) return;
                setStep((currentStep) => currentStep + 1);
              }}
              onSkip={() => {
                if (subscriptionOnly) {
                  handleSubscriptionOnlySkip();
                  return;
                }
                void handleComplete("Onboarding skipped");
              }}
              onFinish={() => void handleStartSubscription()}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
