import type { CoreHttpClient } from "../http-client.js";
import { parseApiResponse } from "../models/api-response.js";
import {
  parseUserIdentity,
  type UserIdentity,
} from "../models/user-identity.js";

export async function fetchUserIdentity(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<UserIdentity> {
  const timeout = AbortSignal.timeout(15_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: unknown;
  try {
    response = await client.get<unknown>("/v1/users/me", requestSignal);
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof error.status === "number" &&
      Number.isInteger(error.status) &&
      error.status >= 100 &&
      error.status <= 599
        ? error.status
        : undefined;
    const message = requestSignal.aborted
      ? "Could not verify the signed-in account: request canceled or timed out."
      : `Could not verify the signed-in account${status ? ` (Core API status ${status})` : ""}.`;
    const safeError = new Error(
      status === 401
        ? `${message} Sign in again to the selected target, then retry.`
        : message,
    );
    if (status !== undefined) {
      Object.defineProperty(safeError, "status", { value: status });
    }
    throw safeError;
  }
  return parseUserIdentity(parseApiResponse<unknown>(response).data);
}
