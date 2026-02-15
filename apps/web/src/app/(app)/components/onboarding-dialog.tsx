"use client";

import { track } from "@vercel/analytics";
import { ArrowLeft, ArrowRight, Bot } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SokosumiIcon } from "@/components/masumi-logos";
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
import { skipOnboarding } from "@/lib/actions/onboarding";

const DISMISSED_KEY = "onboarding-dialog-dismissed";

const COWORKERS = [
  { name: "Elena", role: "Project Management", avatar: "/images/coworkers/elena.webp" },
  { name: "Hannah", role: "Research", avatar: "/images/coworkers/hannah.webp" },
] as const;

const INTRO_STEPS = [
  {
    title: "Welcome to Sokosumi",
    description:
      "Your AI marketing hub. Meet your new coworkers — they're ready to get to work.",
  },
  {
    title: "Tell Them What You Need",
    description:
      "Chat naturally with your coworkers. Describe what you need and they'll take it from there.",
  },
  {
    title: "Work Gets Organized",
    description:
      "Your coworker creates tasks, tracks progress on the Taskboard, and keeps everything on track.",
  },
  {
    title: "They Handle the Rest",
    description:
      "Your coworker hires specialized agents to research, write, analyze — whatever the task requires.",
  },
] as const;

const TOTAL_STEPS = INTRO_STEPS.length + 1;

/* ─── Animated visuals ─── */

function ChatVisual() {
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
            Create a marketing campaign for our product launch
          </div>
        </div>

        {/* Typing indicator */}
        {phase === 2 && (
          <div className="flex items-end gap-2">
            <div className="relative size-6 shrink-0 overflow-hidden rounded-full">
              <Image
                src="/images/coworkers/elena.webp"
                alt="Elena"
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

        {/* Elena response */}
        <div
          className={`flex items-end gap-2 transition-all duration-500 ${
            phase >= 3 ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
          }`}
        >
          <div className="relative size-6 shrink-0 overflow-hidden rounded-full">
            <Image
              src="/images/coworkers/elena.webp"
              alt="Elena"
              fill
              className="object-cover"
            />
          </div>
          <div className="bg-background max-w-[85%] rounded-2xl rounded-bl-sm border px-4 py-2.5 text-[13px]">
            On it! I&apos;ll research the market and draft a campaign strategy.
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskboardVisual() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 2400),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const taskCard = (
    <div className="bg-background rounded-md border p-2.5 shadow-sm">
      <p className="text-[11px] font-medium">Marketing campaign</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="relative size-4 overflow-hidden rounded-full">
          <Image
            src="/images/coworkers/elena.webp"
            alt="Elena"
            fill
            className="object-cover"
          />
        </div>
        <span className="text-muted-foreground text-[10px]">Elena</span>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-[280px] gap-3">
        {/* Todo column */}
        <div className="flex-1">
          <div className="mb-2.5 flex items-center gap-1.5">
            <span className="bg-muted-foreground/40 size-1.5 rounded-full" />
            <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
              Todo
            </span>
          </div>
          <div className="border-border/50 min-h-[100px] rounded-lg border border-dashed p-1.5">
            <div
              className={`transition-all duration-700 ${
                phase >= 1 && phase < 2
                  ? "translate-y-0 opacity-100"
                  : phase >= 2
                    ? "-translate-y-1 opacity-0"
                    : "translate-y-2 opacity-0"
              }`}
            >
              {taskCard}
            </div>
          </div>
        </div>

        {/* In Progress column */}
        <div className="flex-1">
          <div className="mb-2.5 flex items-center gap-1.5">
            <span className="bg-primary size-1.5 rounded-full" />
            <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
              In Progress
            </span>
          </div>
          <div className="border-border/50 min-h-[100px] rounded-lg border border-dashed p-1.5">
            <div
              className={`transition-all duration-700 ${
                phase >= 2 ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"
              }`}
            >
              {taskCard}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrchestrationVisual() {
  const [phase, setPhase] = useState(0);
  const agents = ["Research", "Writing", "Analytics"];

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
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex items-center gap-4">
        {/* Elena node */}
        <div
          className={`flex flex-col items-center gap-1.5 transition-all duration-500 ${
            phase >= 1 ? "scale-100 opacity-100" : "scale-90 opacity-0"
          }`}
        >
          <div className="ring-primary/20 relative size-14 overflow-hidden rounded-full ring-2">
            <Image
              src="/images/coworkers/elena.webp"
              alt="Elena"
              fill
              className="object-cover"
            />
          </div>
          <span className="text-xs font-medium">Elena</span>
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
          <span className="text-muted-foreground text-[10px]">hires</span>
        </div>

        {/* Agent nodes */}
        <div className="flex flex-col gap-2">
          {agents.map((name, i) => (
            <div
              key={name}
              className={`flex items-center gap-2 transition-all duration-500 ${
                phase >= 3 + i ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"
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
          Work delivered
        </div>
        <div className="bg-border h-px w-6" />
      </div>
    </div>
  );
}

/* ─── Navigation ─── */

function StepNavigation({
  step,
  isLoading,
  onBack,
  onNext,
  onSkip,
  onFinish,
}: {
  step: number;
  isLoading: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const isFirst = step === 0;
  const isLast = step === TOTAL_STEPS - 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-1.5">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <span
            key={i}
            className={`size-1.5 rounded-full transition-colors ${
              i === step ? "bg-primary" : "bg-muted-foreground/25"
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        {!isLast ? (
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={onSkip}
            disabled={isLoading}
          >
            Skip
          </Button>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={onBack}
            disabled={isFirst || isLoading}
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          {isLast ? (
            <Button variant="primary" onClick={onFinish} disabled={isLoading}>
              Get Started
            </Button>
          ) : (
            <Button variant="primary" onClick={onNext} disabled={isLoading}>
              Next
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main dialog ─── */

export function OnboardingDialog() {
  const t = useTranslations("Onboarding.Metadata");
  const router = useRouter();
  // TODO: remove — always show for testing
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  if (!open) return null;

  const handleDismiss = async (event: string) => {
    track(event);
    setIsLoading(true);
    try {
      const result = await skipOnboarding();
      if (result.ok) {
        const redirectUrl = result.data.redirectUrl ?? "/agents";
        sessionStorage.setItem(DISMISSED_KEY, "true");
        setOpen(false);
        router.push(redirectUrl);
      } else {
        toast.error(result.error.message ?? "Failed to complete onboarding");
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const isIntroStep = step < INTRO_STEPS.length;
  const isWelcome = step === 0;
  const hasSplitLayout = isIntroStep && !isWelcome;

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-3xl! overflow-hidden border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[90vw] [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="hidden">{t("title")}</DialogTitle>
        <DialogDescription className="hidden">
          {t("description")}
        </DialogDescription>

        <div className="bg-background flex max-h-svh flex-col overflow-hidden rounded-xl shadow-lg md:h-[560px]">
          {/* Content area */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
            {/* Visual panel — stacked on mobile, side panel on desktop */}
            {hasSplitLayout && (
              <div className="bg-muted flex h-44 shrink-0 border-b md:h-auto md:w-[42%] md:shrink md:border-b-0 md:border-r">
                {step === 1 && <ChatVisual />}
                {step === 2 && <TaskboardVisual />}
                {step === 3 && <OrchestrationVisual />}
              </div>
            )}

            {/* Main content */}
            <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center md:p-10">
              {/* Welcome */}
              {isWelcome && (
                <>
                  <SokosumiIcon
                    size={48}
                    animated={false}
                    className="text-foreground"
                  />
                  <h2 className="mt-8 text-2xl font-semibold tracking-tight">
                    {INTRO_STEPS[0].title}
                  </h2>
                  <p className="text-muted-foreground mt-3 max-w-md text-[15px] leading-relaxed">
                    {INTRO_STEPS[0].description}
                  </p>
                  <div className="mt-8 flex items-center gap-3">
                    <div className="flex -space-x-2">
                      {COWORKERS.map((cw) => (
                        <Tooltip key={cw.name}>
                          <TooltipTrigger asChild>
                            <div className="ring-background relative size-8 overflow-hidden rounded-full ring-2">
                              <Image
                                src={cw.avatar}
                                alt={cw.name}
                                fill
                                className="object-cover"
                              />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {cw.name} · {cw.role}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                    <span className="text-muted-foreground text-sm">
                      Elena, Hannah & more
                    </span>
                  </div>
                </>
              )}

              {/* Steps 1–3 text content */}
              {hasSplitLayout && (
                <div className="md:self-start md:text-left">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {INTRO_STEPS[step].title}
                  </h2>
                  <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-[15px] leading-relaxed md:mx-0">
                    {INTRO_STEPS[step].description}
                  </p>
                </div>
              )}

              {/* Close step */}
              {!isIntroStep && (
                <>
                  <div className="flex -space-x-3">
                    {COWORKERS.map((cw) => (
                      <Tooltip key={cw.name}>
                        <TooltipTrigger asChild>
                          <div className="ring-background relative size-12 overflow-hidden rounded-full ring-2">
                            <Image
                              src={cw.avatar}
                              alt={cw.name}
                              fill
                              className="object-cover"
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {cw.name} · {cw.role}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                  <h2 className="mt-6 text-2xl font-semibold tracking-tight">
                    You&apos;re all set
                  </h2>
                  <p className="text-muted-foreground mt-3 max-w-md text-[15px] leading-relaxed">
                    Your coworkers are ready and waiting. Start a chat to get
                    things done.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Fixed bottom navigation */}
          <div className="shrink-0 border-t px-6 pb-6 pt-4 md:px-10 md:pb-8 md:pt-5">
            <StepNavigation
              step={step}
              isLoading={isLoading}
              onBack={() => setStep(step - 1)}
              onNext={() => setStep(step + 1)}
              onSkip={() => handleDismiss("Onboarding skipped")}
              onFinish={() => handleDismiss("Onboarding completed")}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
