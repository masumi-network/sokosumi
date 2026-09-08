import type { CoreHttpClient } from "../http-client.js";
import { type ApiResponse, parseApiResponse } from "../models/api-response.js";
import { type Category, parseCategory } from "../models/category.js";

const CATEGORIES_PATH = "/v1/categories";

export async function fetchCategories(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; categories: Category[] }> {
  const parsed = parseApiResponse(
    await client.get<unknown>(CATEGORIES_PATH, signal),
  );
  const data = Array.isArray(parsed.data) ? parsed.data : [];
  const response: ApiResponse<unknown[]> = { ...parsed, data };
  return { response, categories: data.map(parseCategory) };
}
