import type { CoreHttpClient } from "../http-client.js";
import { type ApiResponse, parseApiResponse } from "../models/api-response.js";
import { parseUser, type User } from "../models/user.js";

const USERS_ME_PATH = "/v1/users/me";

export async function fetchCurrentUser(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; user: User }> {
  const response = parseApiResponse(
    await client.get<unknown>(USERS_ME_PATH, signal),
  );
  return { response, user: parseUser(response.data) };
}
