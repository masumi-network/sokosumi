import "server-only";

import { headers } from "next/headers";

import { createClient } from "@/lib/clients/generated/core/client";

import { coreApiBaseUrl } from "./core.transport.shared";

export async function createCoreGeneratedClient() {
  return createClient({
    baseUrl: coreApiBaseUrl,
    headers: await headers(),
  });
}
