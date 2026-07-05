"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import EmptyState from "@/app/hermes/components/empty-state";
import ErrorState from "@/app/hermes/components/error-state";
import LoadingState from "@/app/hermes/components/loading-state";
import OnboardingProgress from "@/app/hermes/components/onboarding-progress";
import OnboardingScreen from "@/app/hermes/components/onboarding-screen";
import ProvisioningState from "@/app/hermes/components/provisioning-state";
import RunningState from "@/app/hermes/components/running-state";
import {
  destroyHermesAction,
  getHermesInstanceAction,
  listHermesMessagesAction,
  provisionHermesAction,
  startHermesOnboardingAction,
} from "@/lib/actions/hermes";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import type {
  HermesAutonomyLevel,
  HermesInstancePublic,
  HermesInstanceStatus,
  HermesOrganizationOption,
  HermesPersistedMessage,
  HermesPersonality,
} from "@/lib/hermes/types";

export type { HermesOrganizationOption };

type UiState =
  | "loading"
  | "idle"
  | "provisioning"
  | "infrastructure_ready"
  | "onboarding"
  | "running"
  | "error";

interface HermesExperienceProps {
  /** Stable per-user id — the base seed for the generative orb avatar. */
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  userImageUrl?: string | null;
  /** Orgs the user is a member of — drives the confirmation-card dropdown. */
  organizations?: HermesOrganizationOption[];
  /** Active org from the user's session; pre-selected in the dropdown. */
  activeOrganizationId?: string | null;
}

const POLL_INTERVAL_MS = 5_000;
/** Background instance refresh once we're in running state. Keeps the
 * integrations chip and autonomy badge fresh after settings-panel changes
 * without hammering the orchestrator. */
const RUNNING_REFRESH_INTERVAL_MS = 30_000;
const PROVISION_DEADLINE_MS = 15 * 60_000;

const PREVIEW_STATES = new Set<UiState>([
  "idle",
  "provisioning",
  "infrastructure_ready",
  "onboarding",
  "running",
  "error",
]);

function uiStateForServerStatus(status: HermesInstanceStatus): UiState {
  switch (status) {
    case "provisioning":
      return "provisioning";
    case "infrastructure_ready":
      return "infrastructure_ready";
    case "onboarding":
      return "onboarding";
    case "ready":
    case "running":
    case "suspended":
      return "running";
    case "error":
      return "error";
  }
}

/** Statuses that warrant continuous instance polling (waiting for a flip).
 *
 * `infrastructure_ready` is included because the user can sit on the setup
 * wizard for an arbitrary amount of time before they hit Continue — if the
 * orchestrator flips the instance to `error` while they're filling out the
 * form, we want to surface that immediately rather than waiting for the
 * submit to bounce. */
function isPollableTransitionState(status: UiState): boolean {
  return (
    status === "provisioning" ||
    status === "infrastructure_ready" ||
    status === "onboarding"
  );
}

/**
 * Forward-only rank for the Hermes state machine. The polling effect uses
 * this to ignore stale orchestrator reads (e.g. an `infrastructure_ready`
 * response that arrives moments after we've already kicked off /onboard and
 * optimistically moved the UI to `onboarding`). Without this guard, the user
 * ping-pongs between screens during the few seconds the orchestrator takes
 * to mark its own status. `error` is treated as terminal and always allowed.
 */
const STATE_RANK: Record<UiState, number> = {
  loading: 0,
  idle: 1,
  provisioning: 2,
  infrastructure_ready: 3,
  onboarding: 4,
  running: 5,
  error: 99,
};

function isForwardTransition(from: UiState, to: UiState): boolean {
  if (to === "error") return true;
  return STATE_RANK[to] >= STATE_RANK[from];
}

/** Injected when `?mock=confirmation` preview has no real org memberships. */
const MOCK_CONFIRMATION_PREVIEW_ORGANIZATIONS: HermesOrganizationOption[] = [
  { id: "org_personal_demo", name: "My Workspace", slug: "personal" },
  { id: "org_sokosumi", name: "Sokosumi Inc", slug: "sokosumi" },
  { id: "org_acme", name: "Acme Robotics", slug: "acme" },
];

export default function HermesExperience({
  userId,
  userName,
  userEmail,
  userImageUrl,
  organizations = [],
  activeOrganizationId = null,
}: HermesExperienceProps) {
  const params = useSearchParams();
  const isMockConfirmationPreview = params.get("mock") === "confirmation";
  const previewParam = params.get("state");
  const previewMode =
    previewParam !== null && PREVIEW_STATES.has(previewParam as UiState);

  // Preview mode (`?state=running`) is server-data-free, so inject some
  // realistic-looking orgs the dropdown can render. Real sessions pass
  // their actual memberships through the page. Read `mock` from
  // `useSearchParams()` — not `window` — so SSR and hydration agree.
  const usesMockConfirmationOrgs =
    organizations.length === 0 && isMockConfirmationPreview;
  const effectiveOrganizations = usesMockConfirmationOrgs
    ? MOCK_CONFIRMATION_PREVIEW_ORGANIZATIONS
    : organizations;
  const effectiveActiveOrgId =
    activeOrganizationId ??
    (usesMockConfirmationOrgs ? (effectiveOrganizations[1]?.id ?? null) : null);

  const t = useTranslations("App.Hermes.Experience");

  const [uiState, setUiState] = useState<UiState>(
    previewMode ? (previewParam as UiState) : "loading",
  );
  const [instance, setInstance] = useState<HermesInstancePublic | null>(null);
  const [initialMessages, setInitialMessages] = useState<
    HermesPersistedMessage[]
  >([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** True while `POST /me/instance/onboard` is in flight. Keeps the setup
   * wizard mounted so `OnboardingProgress` does not poll until onboard has
   * actually started. */
  const [isStartingOnboarding, setIsStartingOnboarding] = useState(false);
  /**
   * The orb the user committed to during setup, captured optimistically so the
   * provisioning / progress screens show their actual choice before the
   * instance round-trips it back. `undefined` = not chosen this session; `null`
   * = the standard white placeholder; string = the chosen colour seed.
   */
  const [committedSeed, setCommittedSeed] = useState<string | null | undefined>(
    undefined,
  );

  /**
   * Loads instance state then persisted history. Sequenced (not parallel) because
   * `GET /me/instance` lazily upserts the Hermes welcome message on first hit —
   * fetching messages in parallel can resolve before that upsert lands, opening
   * the chat without the intro until the next poll.
   *
   * `background: true` is the mode used by the 30s running-state refresh and
   * by settings-panel mutations. In that mode we deliberately:
   *   - never walk uiState backwards (e.g. don't pull a running chat back
   *     to onboarding on a lagging orchestrator read);
   *   - never apply a lagging instance snapshot when uiState would stay put
   *     (integrations, transitioning, pendingConfirmations, autonomy, etc.
   *     must not snap back while the chat stays visible);
   *   - never flip to the global error state on a transient fetch failure
   *     (just skip the refresh — the user is already happily chatting and
   *     a 503 hiccup shouldn't tear that down);
   *   - never clear the local instance when the response transiently lacks
   *     one (treat as a no-op until the next tick).
   */
  const refetchHermes = useCallback(
    async (options?: { isCancelled?: () => boolean; background?: boolean }) => {
      const isCancelled = options?.isCancelled;
      const background = options?.background ?? false;
      const instanceResult = await getHermesInstanceAction({});
      if (isCancelled?.()) return;
      if (!instanceResult.ok) {
        if (background) return;
        setUiState("error");
        setErrorMessage(instanceResult.error.message ?? t("fetchFailed"));
        return;
      }
      if (!instanceResult.data) {
        if (background) return;
        setUiState("idle");
        setInstance(null);
        return;
      }
      const next = uiStateForServerStatus(instanceResult.data.status);
      // Forward-only guard for background refreshes — same shape as the
      // provisioning/onboarding polling loop's `isForwardTransition` check.
      // Without this, a stale orchestrator read could yank the user from
      // running back to onboarding/provisioning, or leave the chat visible
      // while instance fields (integrations, autonomy, …) snap to older values.
      let applySnapshot = true;
      setUiState((current) => {
        if (background && !isForwardTransition(current, next)) {
          applySnapshot = false;
          return current;
        }
        return next;
      });
      if (!applySnapshot) return;

      const messagesResult = await listHermesMessagesAction({});
      if (isCancelled?.()) return;
      if (messagesResult.ok) {
        setInitialMessages(messagesResult.data);
      }
      setInstance(instanceResult.data);
    },
    [t],
  );

  // Initial fetch (skipped in preview mode).
  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    void refetchHermes({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [previewMode, refetchHermes]);

  // Polling loop bound to any transitional state (`provisioning` or
  // `onboarding`). Starts on entry, teardown cancels in-flight requests
  // and clears the timer.
  useEffect(() => {
    if (previewMode) return;
    if (!isPollableTransitionState(uiState)) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Only enforce the 15-minute deadline while the orchestrator is actually
    // *provisioning*. Once we hit `infrastructure_ready` the user is filling
    // out the multi-step setup wizard and can take arbitrarily long; the
    // same applies to `onboarding` which is driven by the orchestrator's own
    // ETA. Otherwise a user lingering on step 3 of the wizard for >15min
    // would get bounced to a misleading "provisioning timed out" error.
    const deadline =
      uiState === "provisioning" ? Date.now() + PROVISION_DEADLINE_MS : null;

    const tick = async () => {
      if (cancelled) return;
      if (deadline !== null && Date.now() > deadline) {
        setUiState("error");
        setErrorMessage(t("provisionTimeout"));
        return;
      }
      const result = await getHermesInstanceAction({});
      if (cancelled) return;
      if (!result.ok) {
        // Transient orchestrator/network blip — same soft handling as
        // `refetchHermes({ background: true })`. Retry on the next tick
        // instead of ejecting the user from the setup wizard or onboarding
        // loader while the instance may still be healthy.
        timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        return;
      }
      if (result.data) {
        const next = uiStateForServerStatus(result.data.status);
        // Ignore stale polls that would walk the state backwards (e.g. a poll
        // racing the orchestrator's status flip right after we POST /onboard).
        if (!isForwardTransition(uiState, next)) {
          // Stale read — retry without applying snapshot (status or fields).
          timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
          return;
        }
        if (!isPollableTransitionState(next)) {
          if (next === "running") {
            // Orchestrator only flips to `ready` once the welcome message
            // (or a fallback) is already enqueued in the inbox. Our dev
            // poller + chat's own 5s poll will surface it; we preload here
            // so the chat opens with the welcome already rendered.
            const messagesResult = await listHermesMessagesAction({});
            if (cancelled) return;
            if (messagesResult.ok) setInitialMessages(messagesResult.data);
          }
          if (cancelled) return;
          setInstance(result.data);
          setUiState(next);
          return;
        }
        setInstance(result.data);
        if (next !== uiState) setUiState(next);
      } else {
        // Provision call succeeded but the instance disappeared — treat as error.
        setUiState("error");
        setErrorMessage(t("instanceVanished"));
        return;
      }
      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [uiState, previewMode, t]);

  // Low-frequency instance refresh once we're running. The settings panel
  // mutates integration state via local overlay; without a parent refresh the
  // integrations chip and pendingConfirmations on the chat header drift until
  // a full reload.
  useEffect(() => {
    if (previewMode) return;
    if (uiState !== "running") return;
    let cancelled = false;
    const interval = setInterval(() => {
      void refetchHermes({ isCancelled: () => cancelled, background: true });
    }, RUNNING_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [uiState, previewMode, refetchHermes]);

  const handleActivate = useCallback(async () => {
    setUiState("provisioning");
    setErrorMessage(null);
    const result = await provisionHermesAction({});
    if (!result.ok) {
      setUiState("error");
      setErrorMessage(result.error.message ?? t("provisionFailed"));
      return;
    }
    setInstance(result.data);
    const nextUi = uiStateForServerStatus(result.data.status);
    if (nextUi === "running") {
      const messagesResult = await listHermesMessagesAction({});
      if (messagesResult.ok) setInitialMessages(messagesResult.data);
    }
    // Immediately reflect server-side status — if it already came back as
    // "running" the polling effect will just no-op.
    setUiState(nextUi);
  }, [t]);

  const handleRetry = useCallback(() => {
    if (previewMode) return;
    setErrorMessage(null);
    setUiState("loading");
    void refetchHermes();
  }, [previewMode, refetchHermes]);

  const handleDestroy = useCallback(async () => {
    if (previewMode) {
      setInstance(null);
      setUiState("idle");
      return;
    }
    const result = await destroyHermesAction({});
    if (!result.ok) {
      toast.error(result.error.message ?? t("destroyFailed"));
      return;
    }
    setInstance(null);
    setInitialMessages([]);
    setUiState("idle");
  }, [previewMode, t]);

  /**
   * Kicks off the orchestrator's research-intro flow. The progress screen
   * mounts only after `POST /me/instance/onboard` succeeds so step polling
   * does not run against an `infrastructure_ready` instance. Instance
   * polling then catches `ready` and routes to RunningState. Preview mode
   * simulates the transition with a timer for design iteration.
   */
  const handleStartOnboarding = useCallback(
    async (options: {
      skipResearch: boolean;
      name: string | null;
      assistantName: string | null;
      avatarSeed: string | null;
      email: string | null;
      role: string | null;
      company: string | null;
      autonomyLevel: HermesAutonomyLevel;
      personality: HermesPersonality;
    }) => {
      // Show their actual orb choice on the provisioning / progress screens
      // immediately, without waiting for the instance to round-trip it.
      setCommittedSeed(options.avatarSeed);
      if (previewMode) {
        setUiState("onboarding");
        // Mock orchestrator flow: ~30s "research", then flip to running.
        setTimeout(() => {
          setUiState("running");
        }, 30_000);
        return;
      }

      setIsStartingOnboarding(true);
      try {
        const result = await startHermesOnboardingAction({
          skipResearch: options.skipResearch,
          name: options.name,
          assistantName: options.assistantName,
          avatarSeed: options.avatarSeed,
          email: options.email,
          role: options.role,
          company: options.company,
          autonomyLevel: options.autonomyLevel,
          personality: options.personality,
        });
        if (!result.ok) {
          toast.error(result.error.message ?? t("onboardingStartFailed"));
          return;
        }
        // Mount progress UI only after onboard has been accepted — otherwise
        // OnboardingProgress polls while the instance is still
        // `infrastructure_ready` and surfaces false "can't reach orchestrator"
        // warnings.
        setUiState("onboarding");
        // Instance polling (now active for `onboarding`) detects `ready`.
      } finally {
        setIsStartingOnboarding(false);
      }
    },
    [previewMode, t],
  );

  // Base seed for the generative orb avatar — the user id makes every user's
  // orb unique; preview mode (no session) gets a stable placeholder seed.
  const orbBaseSeed = userId ?? "preview-user";
  // The committed avatar: the user's optimistic setup choice, else what the
  // instance persisted. null → the white placeholder orb.
  const committedOrbSeed: string | null =
    committedSeed !== undefined
      ? committedSeed
      : (instance?.avatarSeed ?? null);
  // Surfaces that need a concrete seed (chat message PNGs) fall back to a
  // per-user default.
  const effectiveOrbSeed: string =
    committedOrbSeed ?? defaultOrbSeed(orbBaseSeed);

  if (uiState === "loading") {
    return <LoadingState seed={effectiveOrbSeed} />;
  }

  if (uiState === "idle") {
    return <EmptyState onActivate={handleActivate} />;
  }
  if (uiState === "provisioning") {
    return <ProvisioningState seed={committedOrbSeed} />;
  }
  if (uiState === "infrastructure_ready") {
    return (
      <OnboardingScreen
        defaultName={userName ?? ""}
        defaultEmail={userEmail ?? ""}
        orbBaseSeed={orbBaseSeed}
        integrations={instance?.integrations ?? []}
        previewMode={previewMode}
        isStarting={isStartingOnboarding}
        onContinue={(opts) => void handleStartOnboarding(opts)}
      />
    );
  }
  if (uiState === "onboarding") {
    return (
      <OnboardingProgress previewMode={previewMode} seed={committedOrbSeed} />
    );
  }
  if (uiState === "error") {
    return (
      <ErrorState message={errorMessage ?? undefined} onRetry={handleRetry} />
    );
  }
  return (
    <RunningState
      userName={userName ?? null}
      userImageUrl={userImageUrl ?? null}
      avatarSeed={effectiveOrbSeed}
      instance={instance}
      previewMode={previewMode}
      initialMessages={initialMessages}
      organizations={effectiveOrganizations}
      activeOrganizationId={effectiveActiveOrgId}
      onDestroy={handleDestroy}
      onRefresh={() => refetchHermes({ background: true })}
    />
  );
}
