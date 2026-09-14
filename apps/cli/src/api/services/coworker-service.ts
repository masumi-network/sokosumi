import type { CoreHttpClient } from "../http-client.js";
import { type ApiResponse, parseApiResponse } from "../models/api-response.js";
import {
  type Coworker,
  type CoworkerApiKey,
  parseCoworker,
  parseCoworkerApiKey,
} from "../models/coworker.js";

const COWORKERS_PATH = "/v1/coworkers";

export interface FetchCoworkersOptions {
  scope?: string;
  capability?: string | readonly string[];
  capabilities?: string | readonly string[];
}

export interface CoworkerMutationData {
  name?: string;
  vendorId?: string;
  caption?: string | null;
  url?: string | null;
  baseURL?: string | null;
  description?: string | null;
  capabilities?: readonly string[];
  priority?: number;
  metadata?: Record<string, unknown> | null;
}

export interface CoworkerApiKeyData {
  name?: string | null;
  expiresAt?: string | null;
}

function pathWithQuery(options: FetchCoworkersOptions = {}): string {
  const params = new URLSearchParams();
  if (options.scope) params.set("scope", options.scope.trim());
  const capabilities = options.capabilities ?? options.capability;
  const values = Array.isArray(capabilities)
    ? capabilities
    : capabilities
      ? [capabilities]
      : [];
  for (const capability of values) {
    if (capability) params.append("capability", String(capability).trim());
  }
  const query = params.toString();
  return query ? `${COWORKERS_PATH}?${query}` : COWORKERS_PATH;
}

function parseList(response: ApiResponse<unknown>): ApiResponse<unknown[]> {
  const data = Array.isArray(response.data) ? response.data : [];
  return { ...response, data };
}

function requireId(id: string, name: string): void {
  if (!id) throw new Error(`${name} is required`);
}

export async function fetchCoworkers(
  client: CoreHttpClient,
  options: FetchCoworkersOptions = {},
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; coworkers: Coworker[] }> {
  const response = parseList(
    parseApiResponse(await client.get<unknown>(pathWithQuery(options), signal)),
  );
  return { response, coworkers: response.data.map(parseCoworker) };
}

export async function fetchCoworker(
  client: CoreHttpClient,
  coworkerId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; coworker: Coworker }> {
  requireId(coworkerId, "coworkerId");
  const response = parseApiResponse(
    await client.get<unknown>(
      `${COWORKERS_PATH}/${encodeURIComponent(coworkerId)}`,
      signal,
    ),
  );
  return { response, coworker: parseCoworker(response.data) };
}

export async function fetchCurrentCoworker(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; coworker: Coworker }> {
  const response = parseApiResponse(
    await client.get<unknown>(`${COWORKERS_PATH}/me`, signal),
  );
  return { response, coworker: parseCoworker(response.data) };
}

function mutationPayload(data: CoworkerMutationData): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...data };
  if (typeof data.name === "string") payload.name = data.name.trim();
  if (Array.isArray(data.capabilities))
    payload.capabilities = [...data.capabilities];
  return payload;
}

export async function createCoworker(
  client: CoreHttpClient,
  data: CoworkerMutationData = {},
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; coworker: Coworker }> {
  if (!data.name?.trim()) throw new Error("name is required");
  const response = parseApiResponse(
    await client.post<unknown>(COWORKERS_PATH, mutationPayload(data), signal),
  );
  return { response, coworker: parseCoworker(response.data) };
}

export async function updateCoworker(
  client: CoreHttpClient,
  coworkerId: string,
  data: CoworkerMutationData = {},
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; coworker: Coworker }> {
  requireId(coworkerId, "coworkerId");
  const response = parseApiResponse(
    await client.patch<unknown>(
      `${COWORKERS_PATH}/${encodeURIComponent(coworkerId)}`,
      mutationPayload(data),
      signal,
    ),
  );
  return { response, coworker: parseCoworker(response.data) };
}

export async function createCoworkerApiKey(
  client: CoreHttpClient,
  coworkerId: string,
  data: CoworkerApiKeyData = {},
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; apiKey: CoworkerApiKey }> {
  requireId(coworkerId, "coworkerId");
  const payload: CoworkerApiKeyData = { ...data };
  if (typeof payload.name === "string")
    payload.name = payload.name.trim() || null;
  if (typeof payload.expiresAt === "string")
    payload.expiresAt = payload.expiresAt.trim() || null;
  const response = parseApiResponse(
    await client.post<unknown>(
      `${COWORKERS_PATH}/${encodeURIComponent(coworkerId)}/api-keys`,
      payload,
      signal,
    ),
  );
  return { response, apiKey: parseCoworkerApiKey(response.data) };
}
