"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useReducer, useState } from "react";
import { toast } from "sonner";

import { ensureCoworkerDirectRoomAction } from "@/app/chat/actions";
import { chatMobileHeightShellClass } from "@/app/chat/components/chat-mobile-tab-registry";
import {
  composeDraftKey,
  setComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";
import type { Coworker } from "@/app/chat/utils/types";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { Label } from "@/components/ui/label";
import { Questionnaire } from "@/components/ui/questionnaire";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { stashRoomComposerPrefill } from "./composer-prefill";
import { ConfirmStep } from "./confirm-step";
import { ONBOARDING_STEPS_MAX_WIDTH_CLASS } from "./feature-width";
import { createInitialOnboardingState, reduceOnboarding } from "./machine";
import { ONBOARDING_QUESTION_TREE, stepIndex } from "./questions";
import { chatCapableCoworkers } from "./recommend";
import type { DraftLabelBundle, IntentChoiceId } from "./types";

export interface ChatOnboardingHostProps {
  coworkers: Coworker[];
  userName?: string;
}

const INTENT_CHOICES: readonly IntentChoiceId[] = [
  "chat",
  "tasks",
  "either",
] as const;

/**
 * Owns OnboardingState via useReducer(reduceOnboarding).
 * Confirm mutation order: ensure → stash best-effort → notify → navigate.
 */
export function ChatOnboardingHost({
  coworkers,
  userName,
}: ChatOnboardingHostProps): React.ReactElement {
  const t = useTranslations("App.Chat.Onboarding");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(
    reduceOnboarding,
    undefined,
    createInitialOnboardingState,
  );
  const [goalDraft, setGoalDraft] = useState("");

  const draftLabels = useMemo((): DraftLabelBundle => {
    const intent =
      state.phase.kind === "questionnaire"
        ? state.phase.answers.intent
        : state.phase.answers.intent;
    const intentLabel = intent
      ? t(`intentChoices.${intent}`)
      : t("intentChoices.either");
    return {
      intentLabel,
      goalFallbackLabel: t("goalFallback"),
      composeDraft: ({ intentLabel: label, goalText }) => {
        if (goalText) {
          return t("draftWithGoal", { goal: goalText });
        }
        return t("draftWithIntent", { intent: label });
      },
    };
  }, [state.phase, t]);

  const handleConfirm = useCallback(async () => {
    if (state.phase.kind !== "confirm") {
      return;
    }
    const coworkerId = state.phase.selectedCoworkerId;
    const draftText = state.phase.recommendation.draftText;
    if (!coworkerId || chatCapableCoworkers(coworkers).length === 0) {
      toast.error(t("noChatCoworker"));
      return;
    }

    dispatch({ type: "confirm_start" });
    try {
      const roomResult = await ensureCoworkerDirectRoomAction(coworkerId);
      if (!roomResult.ok || !roomResult.data) {
        const message =
          !roomResult.ok && roomResult.message
            ? roomResult.message
            : t("ensureFailed");
        toast.error(message);
        dispatch({
          type: "confirm_failed",
          error: { kind: "ensure_failed", message },
        });
        return;
      }

      stashRoomComposerPrefill(roomResult.data.id, draftText);
      // Also seed compose-draft so Strict Mode remount still hydrates text
      // after takeRoomComposerPrefill clears sessionStorage.
      try {
        setComposeDraft(composeDraftKey.room(roomResult.data.id), {
          text: draftText,
          attachments: [],
        });
      } catch {
        // best-effort — empty composer OK per Spec
      }
      notifyOrganizationChatRoomsChanged(roomResult.data);
      router.replace(`/chat/rooms/${roomResult.data.id}`);
      dispatch({ type: "confirm_succeeded" });
    } catch {
      const message = t("ensureFailed");
      toast.error(message);
      dispatch({
        type: "confirm_failed",
        error: { kind: "unknown", message },
      });
    }
  }, [coworkers, router, state.phase, t]);

  const greeting = userName
    ? t("greetingWithName", { name: userName })
    : t("greeting");

  return (
    <div
      className={cn(
        "-m-4 flex min-h-0 flex-col overflow-hidden bg-background",
        chatMobileHeightShellClass(pathname, false, searchParams),
      )}
      data-chat-onboarding-host
    >
      <div
        className={cn(
          "mx-auto flex min-h-0 w-full flex-1 flex-col px-4 py-6 md:py-10",
          state.phase.kind === "confirm" || state.phase.kind === "opening"
            ? "max-w-4xl"
            : ONBOARDING_STEPS_MAX_WIDTH_CLASS,
        )}
      >
        {state.phase.kind === "questionnaire" ? (
          <>
            <div className="mb-6 space-y-1">
              <p className="text-muted-foreground text-sm">{greeting}</p>
              <h1 className="text-2xl font-semibold tracking-tight">
                {state.phase.stepId === "intent"
                  ? t("intentTitle")
                  : t("goalTitle")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {state.phase.stepId === "intent"
                  ? t("intentDescription")
                  : t("goalDescription")}
              </p>
            </div>

            <Questionnaire
              stepCount={ONBOARDING_QUESTION_TREE.length}
              stepIndex={stepIndex(state.phase.stepId)}
              onBack={() => dispatch({ type: "back" })}
              onNext={() => {
                if (state.phase.kind !== "questionnaire") {
                  return;
                }
                if (state.phase.stepId === "goal") {
                  const trimmed = goalDraft.trim();
                  dispatch({
                    type: "answer_step",
                    stepId: "goal",
                    value: trimmed
                      ? { kind: "freeform", text: trimmed }
                      : { kind: "skipped" },
                  });
                }
                dispatch({
                  type: "advance",
                  coworkers,
                  draftLabels,
                });
              }}
              onSkip={
                state.phase.stepId === "goal"
                  ? () => {
                      dispatch({
                        type: "answer_step",
                        stepId: "goal",
                        value: { kind: "skipped" },
                      });
                      dispatch({
                        type: "advance",
                        coworkers,
                        draftLabels,
                      });
                    }
                  : undefined
              }
              nextDisabled={
                state.phase.stepId === "intent" && !state.phase.answers.intent
              }
              nextLabel={
                state.phase.stepId === "goal" ? t("finish") : t("next")
              }
              backLabel={t("back")}
              skipLabel={t("skip")}
            >
              {state.phase.stepId === "intent" ? (
                <RadioGroup
                  value={state.phase.answers.intent ?? ""}
                  onValueChange={(value) => {
                    dispatch({
                      type: "answer_step",
                      stepId: "intent",
                      value: { kind: "single", choiceId: value },
                    });
                  }}
                  className="gap-3"
                >
                  {INTENT_CHOICES.map((choice) => (
                    <Label
                      key={choice}
                      htmlFor={`onboarding-intent-${choice}`}
                      className={cn(
                        "border-border hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                        state.phase.kind === "questionnaire" &&
                          state.phase.answers.intent === choice &&
                          "border-primary bg-primary/5",
                      )}
                    >
                      <RadioGroupItem
                        id={`onboarding-intent-${choice}`}
                        value={choice}
                        className="mt-0.5"
                      />
                      <span className="space-y-1">
                        <span className="block font-medium">
                          {t(`intentChoices.${choice}`)}
                        </span>
                        <span className="text-muted-foreground block text-sm font-normal">
                          {t(`intentChoiceHints.${choice}`)}
                        </span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="onboarding-goal">{t("goalLabel")}</Label>
                  <Textarea
                    id="onboarding-goal"
                    value={goalDraft}
                    onChange={(event) => setGoalDraft(event.target.value)}
                    placeholder={t("goalPlaceholder")}
                    rows={4}
                    className="min-h-28"
                  />
                </div>
              )}
            </Questionnaire>
          </>
        ) : null}

        {state.phase.kind === "confirm" || state.phase.kind === "opening" ? (
          <ConfirmStep
            coworkers={coworkers}
            recommendation={state.phase.recommendation}
            selectedCoworkerId={state.phase.selectedCoworkerId}
            draftPreview={state.phase.recommendation.draftText}
            isOpening={state.phase.kind === "opening"}
            errorMessage={
              state.phase.kind === "confirm"
                ? state.phase.lastError?.message
                : undefined
            }
            onSelectCoworker={(coworkerId) =>
              dispatch({ type: "select_coworker", coworkerId })
            }
            onBack={() => dispatch({ type: "back" })}
            onConfirm={() => {
              void handleConfirm();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
