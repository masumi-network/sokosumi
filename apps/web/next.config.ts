import { withSentryConfig } from "@sentry/nextjs/config";
import { withRelatedProject } from "@vercel/related-projects";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { documentSecurityHeaders } from "./src/config/document-security-headers";
import { NEXT_IMAGE_REMOTE_PATTERNS } from "./src/config/next-image";
import {
  PUSH_WORKER_MESSAGES_CACHE_CONTROL,
  PUSH_WORKER_MESSAGES_PATH,
  PUSH_WORKER_RENEWAL_PATH,
} from "./src/config/push-worker-assets";
import {
  getCoreRelatedProjectName,
  normalizeCoreApiBaseUrl,
  resolveCoreNetwork,
  resolveCoreRelatedProjectFallbackHost,
} from "./src/lib/clients/utils/core-api-base-url.shared";

const coreNetwork = resolveCoreNetwork(process.env.NETWORK);
const isWebpackDev = process.env.NEXT_WEBPACK_DEV === "1";
// Vercel production deployments only — not NODE_ENV. Local dev serves plain
// http, so HSTS below must not apply there.
const isVercelProduction = process.env.VERCEL_ENV === "production";
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
  // Old public job shares lived at /share/jobs/:token. Canonical URL is
  // /share/:token (jobs and tasks). Keep a 308 so bookmarks still resolve.
  async redirects() {
    return [
      {
        source: "/share/jobs/:token",
        destination: "/share/:token",
        permanent: true,
      },
    ];
  },
  // Portless named URLs (`https://web.sokosumi.localhost`) and worktree
  // prefixes (`https://main.web.sokosumi.localhost`) hit Next as cross-origin
  // from the proxy. Classic `localhost:3000` still works.
  allowedDevOrigins: ["localhost", "*.localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: documentSecurityHeaders({ includeHsts: isVercelProduction }),
      },
      ...[PUSH_WORKER_MESSAGES_PATH, PUSH_WORKER_RENEWAL_PATH].map(
        (source) => ({
          source,
          headers: [
            {
              key: "Cache-Control",
              value: PUSH_WORKER_MESSAGES_CACHE_CONTROL,
            },
          ],
        }),
      ),
    ];
  },
  env: {
    NEXT_PUBLIC_NETWORK: process.env.NETWORK,
    NEXT_PUBLIC_CORE_APP_BASE_URL: browserCoreApiBaseUrl,
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL:
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  },
  reactCompiler: true,
  images: {
    remotePatterns: [...NEXT_IMAGE_REMOTE_PATTERNS],
  },
  experimental: {
    serverActions: {
      // The largest body any Server Action needs is the coworker image
      // upload: COWORKER_IMAGE_MAX_SIZE_BYTES (2 MB) plus multipart framing.
      // Every other action carries small JSON. Job and task files are
      // uploaded straight to Core, not through a Server Action. Core keeps
      // its own authoritative caps.
      bodySizeLimit: "4mb",
    },
    ...(!isWebpackDev && { turbopackRustReactCompiler: true }),
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

  // v11 runs both of these as JS loaders inside every Turbopack build:
  // component annotation over each .tsx/.jsx, build-time instrumentation
  // over each server .js/.mjs/.cjs. Together they pushed the production
  // compile past the 8 GB of a standard Vercel build machine (exit 137, or
  // a build that hangs until it times out). Web makes no server-side calls
  // into the libraries the instrumentation targets, and v10 never annotated
  // Turbopack builds, so leaving both off loses nothing we had before.
  reactComponentAnnotation: {
    enabled: false,
  },
  buildTimeInstrumentation: false,

  webpack: {
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },

    // Automatically instrument Next.js middleware with error and performance monitoring.
    // disable it on `dev mode` to reduce large middleware bundle size
    autoInstrumentMiddleware: process.env.NODE_ENV === "production",
  },
});
