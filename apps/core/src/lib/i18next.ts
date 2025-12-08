import path from "node:path";
import { fileURLToPath } from "node:url";

import i18next from "i18next";
import FsBackend from "i18next-fs-backend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Initialize i18next with file system backend
 * Supports namespaced locale files in src/locales/{lng}/{ns}.json
 */
export async function initI18next() {
  await i18next.use(FsBackend).init({
    // Default language
    lng: "en",
    fallbackLng: "en",

    // Enable namespaces
    ns: ["common", "emails"],
    defaultNS: "common",

    // File system backend configuration
    backend: {
      loadPath: path.join(__dirname, "../locales/{{lng}}/{{ns}}.json"),
    },

    // Interpolation settings
    interpolation: {
      escapeValue: false, // Not needed for API responses
    },

    // Don't load resources on init, we'll load them via backend
    initImmediate: false,
  });
}

export { i18next };
