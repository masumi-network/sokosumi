"use client";

import { ChevronDown, FlaskConical, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type {
  OnboardingAnswers,
  OnboardingStepId,
  OnboardingTeamPath,
  OnboardingVariant,
} from "./onboarding-steps";
import type { InviteLinkPreviewState } from "./steps/team-steps";

export interface OnboardingPreviewState {
  answers: OnboardingAnswers;
  createOrganizationStep: number;
  hasJoinedOrganization: boolean;
  invitePreview: InviteLinkPreviewState | null;
  inviteValue: string;
  stepId: OnboardingStepId;
  teamPath: null | OnboardingTeamPath;
  variant: OnboardingVariant;
}

interface OnboardingPreviewToolbarProps extends OnboardingPreviewState {
  onApply: (state: OnboardingPreviewState) => void;
}

/** Answers good enough to unlock every downstream branch. */
const SAMPLE_ANSWERS: OnboardingAnswers = {
  companySize: "11-50",
  companyType: "agency",
  role: "founder",
  workStyle: "team",
};

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
 * Branches are reached by seeding the answers that lead to them rather than by
 * clicking through, so a screen deep in the team path is one click away.
 */
const SCENARIOS: PreviewScenario[] = [
  {
    key: "welcome",
    label: "1 · Welcome",
    state: {
      answers: { ...SAMPLE_ANSWERS, workStyle: null },
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "welcome",
      teamPath: null,
      variant: "full",
    },
  },
  {
    key: "companyType",
    label: "2 · Company type",
    state: {
      answers: {
        companySize: null,
        companyType: null,
        role: null,
        workStyle: null,
      },
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "companyType",
      teamPath: null,
      variant: "full",
    },
  },
  {
    key: "companySize",
    label: "3 · Company size",
    state: {
      answers: { ...SAMPLE_ANSWERS, companySize: null, workStyle: null },
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "companySize",
      teamPath: null,
      variant: "full",
    },
  },
  {
    key: "role",
    label: "4 · Role",
    state: {
      answers: { ...SAMPLE_ANSWERS, role: null, workStyle: null },
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "role",
      teamPath: null,
      variant: "full",
    },
  },
  {
    key: "workStyle",
    label: "5 · Solo or team",
    state: {
      answers: { ...SAMPLE_ANSWERS, workStyle: null },
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "workStyle",
      teamPath: null,
      variant: "full",
    },
  },
  {
    key: "teamChoice",
    label: "6 · Link or new team",
    state: {
      answers: SAMPLE_ANSWERS,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "teamChoice",
      teamPath: null,
      variant: "full",
    },
  },
  {
    key: "inviteLink-empty",
    label: "7a · Paste link (empty)",
    state: {
      answers: SAMPLE_ANSWERS,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "inviteLink",
      teamPath: "invite",
      variant: "full",
    },
  },
  {
    key: "inviteLink-resolved",
    label: "7b · Paste link (resolved)",
    state: {
      answers: SAMPLE_ANSWERS,
      hasJoinedOrganization: false,
      invitePreview: SAMPLE_INVITE_PREVIEW,
      inviteValue: SAMPLE_INVITE_URL,
      stepId: "inviteLink",
      teamPath: "invite",
      variant: "full",
    },
  },
  {
    key: "inviteLink-joined",
    label: "7c · Joined team",
    state: {
      answers: SAMPLE_ANSWERS,
      hasJoinedOrganization: true,
      invitePreview: SAMPLE_INVITE_PREVIEW,
      inviteValue: SAMPLE_INVITE_URL,
      stepId: "inviteLink",
      teamPath: "invite",
      variant: "full",
    },
  },
  {
    key: "createOrg-details",
    label: "8a · New team · details",
    state: {
      answers: SAMPLE_ANSWERS,
      createOrganizationStep: 0,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "createOrganization",
      teamPath: "create",
      variant: "full",
    },
  },
  {
    key: "createOrg-logo",
    label: "8b · New team · logo",
    state: {
      answers: SAMPLE_ANSWERS,
      createOrganizationStep: 1,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "createOrganization",
      teamPath: "create",
      variant: "full",
    },
  },
  {
    key: "createOrg-brand",
    label: "8c · New team · brand",
    state: {
      answers: SAMPLE_ANSWERS,
      createOrganizationStep: 2,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "createOrganization",
      teamPath: "create",
      variant: "full",
    },
  },
  {
    key: "createOrg-invite",
    label: "8d · New team · invite",
    state: {
      answers: SAMPLE_ANSWERS,
      createOrganizationStep: 3,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "createOrganization",
      teamPath: "create",
      variant: "full",
    },
  },
  {
    key: "plan-org",
    label: "9a · Plans (team)",
    state: {
      answers: SAMPLE_ANSWERS,
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "plan",
      teamPath: "create",
      variant: "full",
    },
  },
  {
    key: "plan-solo",
    label: "9b · Plans (solo)",
    state: {
      answers: { ...SAMPLE_ANSWERS, workStyle: "solo" },
      hasJoinedOrganization: false,
      invitePreview: null,
      inviteValue: "",
      stepId: "plan",
      teamPath: null,
      variant: "full",
    },
  },
  {
    key: "joined-welcome",
    label: "10a · Invited · welcome",
    state: {
      answers: {
        companySize: null,
        companyType: null,
        role: null,
        workStyle: null,
      },
      hasJoinedOrganization: true,
      invitePreview: null,
      inviteValue: "",
      stepId: "welcome",
      teamPath: null,
      variant: "joined",
    },
  },
  {
    key: "joined-role",
    label: "10b · Invited · role (last)",
    state: {
      answers: { ...SAMPLE_ANSWERS, role: null, workStyle: null },
      hasJoinedOrganization: true,
      invitePreview: null,
      inviteValue: "",
      stepId: "role",
      teamPath: null,
      variant: "joined",
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
  variant,
  ...rest
}: OnboardingPreviewToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeScenario = SCENARIOS.find((scenario) => {
    if (scenario.state.stepId !== stepId) return false;
    if (scenario.state.variant !== variant) return false;
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
