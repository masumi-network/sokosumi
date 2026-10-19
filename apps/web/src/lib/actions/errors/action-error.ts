import { UNAUTHENTICATED_ERROR_DIGEST } from "@/lib/auth/errors";
import { CommonErrorCode } from "./error-codes/common";

export type ActionError = {
  code: string;
  kind?: string | undefined;
  /** The Core HTTP status, for actions whose UI words each refusal itself. */
  status?: number | undefined;
  message?: string | undefined | null;
};

export function toActionRejectionError(error: unknown): ActionError {
  if (typeof error === "object" && error !== null) {
    const serialized = error as { digest?: unknown; name?: unknown };
    if (
      serialized.name === "UnAuthenticatedError" ||
      serialized.digest === UNAUTHENTICATED_ERROR_DIGEST
    ) {
      return { code: CommonErrorCode.UNAUTHENTICATED };
    }
  }

  return { code: CommonErrorCode.INTERNAL_SERVER_ERROR };
}
