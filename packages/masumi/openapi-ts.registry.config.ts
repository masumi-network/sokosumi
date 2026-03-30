import { defaultPlugins } from "@hey-api/openapi-ts";

const config = {
  input:
    "https://masumi-registry-sokosumi-dev-9f342.ondigitalocean.app/api-docs",
  output: {
    path: "./src/clients/openapi/generated/registry",
    tsConfigPath: "./tsconfig.json",
    importFileExtension: "js",
  },
  name: "MasumiRegistryClient",
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
