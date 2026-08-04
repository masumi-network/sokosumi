import { unstable_rethrow } from "next/navigation";
import { CoreApiRequestError } from "@/lib/clients/core.client";

export function actionErrorMessage(error: unknown, fallback: string): string {
  unstable_rethrow(error);

  if (error instanceof CoreApiRequestError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
