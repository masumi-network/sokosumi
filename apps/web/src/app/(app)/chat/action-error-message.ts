import { CoreApiRequestError } from "@/lib/clients/core.client";

export function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof CoreApiRequestError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
