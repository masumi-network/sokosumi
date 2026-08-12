import { toast } from "sonner";

import { CommonErrorCode } from "@/lib/actions";

export interface SubscriptionActionErrorMessages {
  badInputMessage: string;
  generalMessage: string;
  unauthenticatedActionLabel: string;
  unauthenticatedMessage: string;
  unauthorizedMessage?: string;
}

/**
 * Shared error toast path for onboarding subscribe / free-upgrade checkout.
 * Keeps UNAUTHENTICATED (with login action) and BAD_INPUT/UNAUTHORIZED fallbacks
 * aligned across the full-page flow and the subscription dialog.
 */
export function toastSubscriptionActionError(
  error: { code: string; message?: null | string },
  options: SubscriptionActionErrorMessages & {
    onUnauthenticated: () => void;
  },
): void {
  if (error.code === CommonErrorCode.UNAUTHENTICATED) {
    toast.error(options.unauthenticatedMessage, {
      action: {
        label: options.unauthenticatedActionLabel,
        onClick: options.onUnauthenticated,
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
