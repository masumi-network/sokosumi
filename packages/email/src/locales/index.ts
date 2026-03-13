import { createRequire } from "node:module";

import type { AbstractIntlMessages } from "use-intl/core";

const require = createRequire(import.meta.url);

const de = require("./de.json") as AbstractIntlMessages;
const en = require("./en.json") as AbstractIntlMessages;
const es = require("./es.json") as AbstractIntlMessages;
const fr = require("./fr.json") as AbstractIntlMessages;
const it = require("./it.json") as AbstractIntlMessages;
const ja = require("./ja.json") as AbstractIntlMessages;
const pt = require("./pt.json") as AbstractIntlMessages;
const ptBR = require("./pt-BR.json") as AbstractIntlMessages;
const zhHans = require("./zh-Hans.json") as AbstractIntlMessages;

export const EMAIL_LOCALES = [
  "en",
  "de",
  "es",
  "fr",
  "it",
  "ja",
  "pt",
  "pt-BR",
  "zh-Hans",
] as const;

export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export const EMAIL_MESSAGES = {
  en,
  de,
  es,
  fr,
  it,
  ja,
  pt,
  "pt-BR": ptBR,
  "zh-Hans": zhHans,
} satisfies Record<EmailLocale, AbstractIntlMessages>;
