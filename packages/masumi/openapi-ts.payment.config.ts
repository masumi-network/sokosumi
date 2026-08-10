import { defaultPlugins } from "@hey-api/openapi-ts";

const config = {
  // Pinned spec snapshot — refresh via `pnpm fetch:specs` (see spec/SPEC_SOURCES.md).
  input: "./spec/payment.openapi.json",
  output: {
    path: "./src/clients/openapi/generated/payment",
    tsConfigPath: "./tsconfig.json",
    importFileExtension: "js",
  },
  name: "MasumiPaymentClient",
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
