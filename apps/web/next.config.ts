/* eslint-disable no-restricted-properties */
import { withSentryConfig } from "@sentry/nextjs";
import { withRelatedProject } from "@vercel/related-projects";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { CROSS_ORIGIN_OPENER_POLICY } from "./src/config/document-security-headers";
import { NEXT_IMAGE_REMOTE_PATTERNS } from "./src/config/next-image";
import {
  getCoreRelatedProjectName,
  normalizeCoreApiBaseUrl,
  resolveCoreNetwork,
  resolveCoreRelatedProjectFallbackHost,
} from "./src/lib/clients/utils/core-api-base-url.shared";

const coreNetwork = resolveCoreNetwork(process.env.NETWORK);
const browserCoreApiBaseUrl = normalizeCoreApiBaseUrl(
  withRelatedProject({
    projectName: getCoreRelatedProjectName(coreNetwork),
    defaultHost: resolveCoreRelatedProjectFallbackHost({
      configuredCoreAppBaseUrl: process.env.CORE_APP_BASE_URL,
      network: coreNetwork,
      vercelEnv: process.env.VERCEL_ENV,
      vercelGitCommitRef: process.env.VERCEL_GIT_COMMIT_REF,
    }),
  }),
);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // SOK-797 shipped `/workspace-gate`; product path is now `/setup` (SOK-798).
  // Query string is preserved by Next.js redirects by default.
  async redirects() {
    return [
      {
        source: "/workspace-gate",
        destination: "/setup",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: CROSS_ORIGIN_OPENER_POLICY,
          },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_NETWORK: process.env.NETWORK,
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
    turbopackRustReactCompiler: true,
    optimizePackageImports: ["lucide-react", "radix-ui"],
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
