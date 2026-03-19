import "server-only";

import { headers } from "next/headers";

import { createClient } from "@/lib/clients/generated/core/client";

import {
  coreApiBaseUrl,
  normalizeCoreApiBaseUrl,
} from "./core.transport.shared";

export async function createCoreGeneratedClient() {
  return createClient({
    baseUrl: normalizeCoreApiBaseUrl(coreApiBaseUrl),
    headers: await headers(),
  });
}
