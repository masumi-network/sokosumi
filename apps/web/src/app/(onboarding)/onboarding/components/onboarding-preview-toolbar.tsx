"use client";

import { ChevronDown, FlaskConical, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type {
  OnboardingStepId,
  OnboardingTeamPath,
  OnboardingWorkStyle,
} from "./onboarding-steps";
import type { InviteLinkPreviewState } from "./steps/team-steps";

export interface OnboardingPreviewState {
  createOrganizationStep: number;
  hasJoinedOrganization: boolean;
  invitePreview: InviteLinkPreviewState | null;
  inviteValue: string;
  stepId: OnboardingStepId;
  teamPath: null | OnboardingTeamPath;
  workStyle: null | OnboardingWorkStyle;
}

interface OnboardingPreviewToolbarProps extends OnboardingPreviewState {
  onApply: (state: OnboardingPreviewState) => void;
}

const SAMPLE_INVITE_PREVIEW: InviteLinkPreviewState = {
  logo: null,
  name: "Acme Marketing",
};

const SAMPLE_INVITE_URL =
  "https://app.sokosumi.com/join/TJtnWS1AM_0J7cIZUcHD_k63W955Mmna";

interface PreviewScenario {
  key: string;
  label: string;
  state: Omit<OnboardingPreviewState, "createOrganizationStep"> & {
    createOrganizationStep?: number;
  };
}

/**
 * Every screen the flow can render, as a flat jump list.
 *
 * Branches are reached by seeding the state that leads to them rather than by
 * clicking through, so a screen deep in the team path is one click away.
 */
const SCENARIOS: PreviewScenario[] = [
  {
    key: "welcome",
    label: "1 · Welcome",
    state: {
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "welcome",
      teamPath: null,
      workStyle: null,
    },
  },
  {
    key: "workStyle",
    label: "2 · Solo or team",
    state: {
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "workStyle",
      teamPath: null,
      workStyle: null,
    },
  },
  {
    key: "teamChoice",
    label: "3 · Link or new team",
    state: {
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "teamChoice",
      teamPath: null,
      workStyle: "team",
    },
  },
  {
    key: "invite-empty",
    label: "4a · Paste link (empty)",
    state: {
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "inviteLink",
      teamPath: "invite",
      workStyle: "team",
    },
  },
  {
    key: "invite-resolved",
    label: "4b · Paste link (resolved)",
    state: {
      hasJoinedOrganization: false,
      invitePreview: SAMPLE_INVITE_PREVIEW,
      inviteValue: SAMPLE_INVITE_URL,
      stepId: "inviteLink",
      teamPath: "invite",
      workStyle: "team",
    },
  },
  {
    key: "invite-joined",
    label: "4c · Joined team",
    state: {
      hasJoinedOrganization: true,
      invitePreview: SAMPLE_INVITE_PREVIEW,
      inviteValue: SAMPLE_INVITE_URL,
      stepId: "inviteLink",
      teamPath: "invite",
      workStyle: "team",
    },
  },
  {
    key: "createOrg-details",
    label: "5a · New team · details",
    state: {
      createOrganizationStep: 0,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "createOrganization",
      teamPath: "create",
      workStyle: "team",
    },
  },
  {
    key: "createOrg-logo",
    label: "5b · New team · logo",
    state: {
      createOrganizationStep: 1,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "createOrganization",
      teamPath: "create",
      workStyle: "team",
    },
  },
  {
    key: "createOrg-brand",
    label: "5c · New team · brand",
    state: {
      createOrganizationStep: 2,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "createOrganization",
      teamPath: "create",
      workStyle: "team",
    },
  },
  {
    key: "createOrg-invite",
    label: "5d · New team · invite",
    state: {
      createOrganizationStep: 3,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "createOrganization",
      teamPath: "create",
      workStyle: "team",
    },
  },
  {
    key: "plan-team",
    label: "6a · Plans (team)",
    state: {
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "plan",
      teamPath: "create",
      workStyle: "team",
    },
  },
  {
    key: "plan-solo",
    label: "6b · Plans (solo)",
    state: {
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "plan",
      teamPath: null,
      workStyle: "solo",
    },
  },
];

/**
 * Dev-only jump list for the onboarding branches.
 *
 * Rendered when `?preview=1` is set outside production. Actions inside the
 * flow still hit the real backend — this only moves the cursor, so the same
 * URL doubles as a manual test harness.
 */
export function OnboardingPreviewToolbar({
  createOrganizationStep,
  onApply,
  stepId,
  ...rest
}: OnboardingPreviewToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeScenario = SCENARIOS.find((scenario) => {
    if (scenario.state.stepId !== stepId) return false;
    if (stepId === "createOrganization") {
      return scenario.state.createOrganizationStep === createOrganizationStep;
    }
    if (stepId === "inviteLink") {
      return (
        scenario.state.hasJoinedOrganization === rest.hasJoinedOrganization &&
        Boolean(scenario.state.invitePreview) === Boolean(rest.invitePreview)
      );
    }
    return true;
  });

  return (
    // Sits above the Next.js dev indicator, which owns the bottom-left corner.
    <div className="pointer-events-none fixed bottom-16 left-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2">
      {isOpen ? (
        <div className="pointer-events-auto bg-popover max-h-[60vh] w-64 overflow-y-auto rounded-xl border p-1.5 shadow-lg">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.key}
              type="button"
              onClick={() =>
                onApply({
                  createOrganizationStep:
                    scenario.state.createOrganizationStep ?? 0,
                  ...scenario.state,
                })
              }
              className={cn(
                "hover:bg-accent w-full rounded-lg px-3 py-2 text-left text-[0.8125rem] transition-colors",
                activeScenario?.key === scenario.key && "bg-accent font-medium",
              )}
            >
              {scenario.label}
            </button>
          ))}
        </div>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="pointer-events-auto h-9 gap-2 rounded-full border shadow-md"
        onClick={() => setIsOpen((current) => !current)}
      >
        <FlaskConical className="size-3.5" />
        <span className="font-mono text-[0.75rem]">
          {activeScenario?.label ?? stepId}
        </span>
        {isOpen ? (
          <X className="size-3.5" />
        ) : (
          <ChevronDown className="size-3.5 rotate-180" />
        )}
      </Button>
    </div>
  );
}
