import { createRequire } from "node:module";

import type { AbstractIntlMessages } from "use-intl/core";

const require = createRequire(import.meta.url);

const de = require("./de.json") as AbstractIntlMessages;
const en = require("./en.json") as AbstractIntlMessages;
const es = require("./es.json") as AbstractIntlMessages;

export const EMAIL_LOCALES = ["en", "de", "es"] as const;

export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export const EMAIL_MESSAGES = {
  en,
  de,
  es,
} satisfies Record<EmailLocale, AbstractIntlMessages>;
