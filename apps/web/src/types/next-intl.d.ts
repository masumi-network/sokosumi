import {
  NamespaceKeys,
  NestedKeyOf,
  useFormatter,
  useTranslations,
} from "next-intl";

import en from "@/messages/en.json";

type Messages = typeof en;

/**
 * next-intl's `AbstractIntlMessages` shape is `{ [k]: string | AbstractIntlMessages }`
 * — strings or nested objects only, no arrays. Ordered lists must be
 * keyed maps (`{ "0": "…", "1": "…" }`) rehydrated via `orderedMessageList`.
 * This widened value type still accepts residual arrays so a mismatched
 * locale catalog cannot collapse `IntlMessages` to `never` and break the
 * build — keep non-`en` catalogs in map shape to match `en.json`.
 */
type SokosumiIntlValue =
  | string
  | readonly string[]
  | readonly SokosumiIntlMessages[]
  | SokosumiIntlMessages;
type SokosumiIntlMessages = {
  [id: string]: SokosumiIntlValue;
};

declare global {
  // Use type safe message keys with `next-intl`
  type IntlMessages = Messages extends SokosumiIntlMessages ? Messages : never;
  type IntlNestedKey = NamespaceKeys<IntlMessages, NestedKeyOf<IntlMessages>>;
  type IntlNamespaceKeys = NamespaceKeys<
    IntlMessages,
    NestedKeyOf<IntlMessages>
  >;
  type IntlTranslation<NestedKey extends IntlNestedKey> = ReturnType<
    typeof useTranslations<NestedKey>
  >;

  type IntlDateFormatter = ReturnType<typeof useFormatter>;
}
