import baseConfig from "./index.mjs";

/** @type {import('prettier').Config} */
const config = {
  ...baseConfig,
  plugins: ["prettier-plugin-tailwindcss"],
};

export default config;


