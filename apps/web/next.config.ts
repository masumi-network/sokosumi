/* eslint-disable no-restricted-properties */
import { withSentryConfig } from "@sentry/nextjs";
import { withRelatedProject } from "@vercel/related-projects";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { getEnvSecrets } from "@/config/env.secrets";

import { NEXT_IMAGE_REMOTE_PATTERNS } from "./src/config/next-image";
import {
  getCoreRelatedProjectName,
  normalizeCoreApiBaseUrl,
} from "./src/lib/clients/utils/core-api-base-url.shared";

const secrets = getEnvSecrets();

const browserCoreApiBaseUrl = normalizeCoreApiBaseUrl(
  withRelatedProject({
    projectName: getCoreRelatedProjectName(secrets.NETWORK),
    defaultHost: process.env.CORE_APP_BASE_URL ?? "http://localhost:8787",
  }),
);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_NETWORK: secrets.NETWORK,
    NEXT_PUBLIC_CORE_APP_BASE_URL: browserCoreApiBaseUrl,
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  },
  reactCompiler: true,
  images: {
    remotePatterns: [...NEXT_IMAGE_REMOTE_PATTERNS],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
    optimizePackageImports: ["lucide-react"],
  },
  serverExternalPackages: ["ably", "@sparticuz/chromium", "puppeteer-core"],
};

const withNextIntl = createNextIntlPlugin();

export default withSentryConfig(withNextIntl(nextConfig), {
  // Disable telemetry to avoid sending data to Sentry
  telemetry: process.env.NODE_ENV === "production",

  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options
  org: "masumi",
  project: process.env.SENTRY_PROJECT ?? "sokosumi",

  // Pass the auth token
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-side errors will fail.
  tunnelRoute: true, // Generates a random route for each build (recommended)

  webpack: {
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },

    // Enable React component annotation for better error messages
    reactComponentAnnotation: {
      enabled: true,
    },

    // Automatically instrument Next.js middleware with error and performance monitoring.
    // disable it on `dev mode` to reduce large middleware bundle size
    autoInstrumentMiddleware: process.env.NODE_ENV === "production",
  },
});
