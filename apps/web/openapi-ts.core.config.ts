import { defaultPlugins } from "@hey-api/openapi-ts";

const config = {
  input: "http://localhost:8787/v1/openapi.json",
  output: "./src/lib/clients/generated/core",
  name: "SokosumiCoreClient",
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
