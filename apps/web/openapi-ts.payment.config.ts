import { defaultPlugins } from "@hey-api/openapi-ts";

const config = {
  input: "https://masumi-payment-sokosumi-agvae.ondigitalocean.app/api-docs",
  output: "./src/lib/clients/generated/payment",
  name: "MasumiPaymentClient",
  baseUrl: "https://masumi-payment-sokosumi-agvae.ondigitalocean.app/api/v1",
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
