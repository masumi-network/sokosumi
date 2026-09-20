import type { CoreHttpClient } from "../http-client.js";
import { type ApiResponse, parseApiResponse } from "../models/api-response.js";
import { parseVendor, type Vendor } from "../models/vendor.js";

export interface FetchVendorMembershipsResult {
  response: ApiResponse<Vendor[]>;
  vendors: Vendor[];
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
