import { join } from "path";
import type { Configuration } from "puppeteer";

const config: Configuration = {
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
  // Chrome for Testing approach (recommended)
  chrome: {
    version: "138.0.7204.168",
  },

  skipDownload: false,
};

export default config;
