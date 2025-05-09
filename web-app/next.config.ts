import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withPlausibleProxy } from "next-plausible";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "c-ipfs-gw.nmkr.io",
      },
    ],
  },
};

const withNextIntl = createNextIntlPlugin();

export default withSentryConfig(
  withNextIntl(withPlausibleProxy()(nextConfig)),
  {
    // Disable telemetry to avoid sending data to Sentry
    // eslint-disable-next-line no-restricted-properties
    telemetry: process.env.NODE_ENV === "production",

    // For all available options, see:
    // https://www.npmjs.com/package/@sentry/webpack-plugin#options
    org: "masumi",
    project: "sokosumi",

    // Only print logs for uploading source maps in CI
    // eslint-disable-next-line no-restricted-properties
    silent: !process.env.CI,

    // For all available options, see:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

    // Upload a larger set of source maps for prettier stack traces (increases build time)
    widenClientFileUpload: true,

    // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
    // This can increase your server load as well as your hosting bill.
    // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
    // side errors will fail.
    tunnelRoute: "/monitoring",

    // Automatically tree-shake Sentry logger statements to reduce bundle size
    disableLogger: true,
  },
);
