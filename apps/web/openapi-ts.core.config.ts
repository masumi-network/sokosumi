/* eslint-disable no-restricted-properties */
import { defaultPlugins } from "@hey-api/openapi-ts";

const DEFAULT_CORE_API_URL = "https://api.sokosumi.com";

function normalizeCoreApiBaseUrl(url: string): string {
  const withoutTrailingSlash = url.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1`;
}

const coreApiBaseUrl = normalizeCoreApiBaseUrl(
  process.env.CORE_API_URL ?? DEFAULT_CORE_API_URL,
);
const coreOpenApiUrl = process.env.CORE_OPENAPI_URL ?? `${coreApiBaseUrl}/openapi.json`;

const config = {
  input: coreOpenApiUrl,
  output: "./src/lib/clients/generated/core",
  name: "SokosumiCoreClient",
  baseUrl: coreApiBaseUrl,
  plugins: [
    ...defaultPlugins,
    "@hey-api/client-next",
    "@hey-api/schemas",
    {
      dates: true,
      name: "@hey-api/transformers",
    },
    {
      enums: "javascript",
      name: "@hey-api/typescript",
    },
    {
      name: "@hey-api/sdk",
      transformer: true,
    },
  ],
};

export default config;
