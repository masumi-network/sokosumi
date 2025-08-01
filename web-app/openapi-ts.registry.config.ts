import { defaultPlugins } from "@hey-api/openapi-ts";

const config = {
  input: "https://registry.masumi.network/api-docs",
  output: "./src/lib/clients/generated/registry",
  name: "MasumiRegistryClient",
  baseUrl: "https://registry.masumi.network/api/v1",
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
  options: {
    authentication: {
      token: {
        name: "token",
        in: "header",
      },
    },
  },
};

export default config;
