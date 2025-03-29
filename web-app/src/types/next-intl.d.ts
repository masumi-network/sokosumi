import {
  AbstractIntlMessages,
  NamespaceKeys,
  NestedKeyOf,
  useFormatter,
  useTranslations,
} from "next-intl";

import en from "@/messages/en.json";

type Messages = typeof en;

declare global {
  // Use type safe message keys with `next-intl`
  type IntlMessages = Messages extends AbstractIntlMessages ? Messages : never;
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
