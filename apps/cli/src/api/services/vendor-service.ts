import type { CoreHttpClient } from "../http-client.js";
import { parseApiResponse } from "../models/api-response.js";
import { parseVendor, type Vendor } from "../models/vendor.js";

export interface CreateVendorInput {
  name: string;
  slug: string;
}

export async function fetchVendorMemberships(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<{ vendors: Vendor[] }> {
  const response = parseApiResponse<unknown[]>(
    await client.get<unknown>("/v1/vendors/me", signal),
  );
  if (!Array.isArray(response.data)) {
    throw new Error("Invalid vendor response: expected data array");
  }
  return { vendors: response.data.map(parseVendor) };
}

export async function createVendor(
  client: CoreHttpClient,
  input: CreateVendorInput,
  signal?: AbortSignal,
): Promise<{ vendor: Vendor }> {
  const name = input.name.trim();
  const slug = input.slug.trim();
  if (!name) throw new Error("Vendor name is required");
  if (!slug) throw new Error("Vendor slug is required");
  const response = parseApiResponse<unknown>(
    await client.post<unknown>("/v1/vendors", { name, slug }, signal),
  );
  const vendor = parseVendor(response.data);
  if (vendor.role !== "admin") {
    throw new Error("Invalid vendor create response: expected admin role");
  }
  return { vendor };
}
