import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { validateEnv } from "@/config/env.config";

validateEnv();

const nextConfig: NextConfig = {};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
