import type { CoreHttpClient } from "../http-client.js";
import { type ApiResponse, parseApiResponse } from "../models/api-response.js";
import { parseVendor, type Vendor } from "../models/vendor.js";

export interface FetchVendorMembershipsResult {
  response: ApiResponse<Vendor[]>;
  vendors: Vendor[];
}

export interface CreateVendorInput {
  name: string;
  slug: string;
}

export interface CreateVendorResult {
  response: ApiResponse<Vendor>;
  vendor: Vendor;
}

export async function fetchVendorMemberships(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<FetchVendorMembershipsResult> {
  const response = parseApiResponse<unknown[]>(
    await client.get<unknown>("/v1/vendors/me", signal),
  );
  if (!Array.isArray(response.data)) {
    throw new Error("Invalid vendor response: expected data array");
  }
  const data = response.data;
  const vendors = data.map(parseVendor);
  const normalizedResponse: ApiResponse<Vendor[]> = {
    ...response,
    data: vendors,
  };
  return { response: normalizedResponse, vendors };
}

export async function createVendor(
  client: CoreHttpClient,
  input: CreateVendorInput,
  signal?: AbortSignal,
): Promise<CreateVendorResult> {
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
  return {
    response: { ...response, data: vendor },
    vendor,
  };
}
