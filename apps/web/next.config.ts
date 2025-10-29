/* eslint-disable no-restricted-properties */
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "c-ipfs-gw.nmkr.io",
      },
      {
        protocol: "https",
        hostname: "yhpsw8jlcoagsrkq.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "igcd4cnfvuav1zto.public.blob.vercel-storage.com",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  serverExternalPackages: ["ably", "@sparticuz/chromium", "puppeteer-core"],
  webpack: (config) => {
    // Suppress webpack cache serialization warnings for large strings
    // These are typically from Prisma client or other generated code and don't impact functionality
    config.infrastructureLogging = {
      ...config.infrastructureLogging,
      level: "error",
    };
    return config;
  },
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

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Automatically instrument Next.js middleware with error and performance monitoring.
  // disable it on `dev mode` to reduce large middleware bundle size
  autoInstrumentMiddleware: process.env.NODE_ENV === "production",

  // Enable React component annotation for better error messages
  reactComponentAnnotation: {
    enabled: true,
  },
});
