import en from "messages/en.json";
import {
  AbstractIntlMessages,
  NamespaceKeys,
  NestedKeyOf,
  useTranslations,
} from "next-intl";

type Messages = typeof en;

declare global {
  // Use type safe message keys with `next-intl`
  type IntlMessages = Messages extends AbstractIntlMessages ? Messages : never;
  type IntlNestedKey = NamespaceKeys<IntlMessages, NestedKeyOf<IntlMessages>>;
  type IntlTranslation<NestedKey extends IntlNestedKey> = ReturnType<
    typeof useTranslations<NestedKey>
  >;
}
