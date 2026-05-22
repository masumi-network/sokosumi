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
 * — strings or nested objects only, no arrays. Several Hermes copy keys
 * (`hints`, `roleOptions`, `demoInbox`, etc.) are arrays of strings or
 * arrays of small objects that we read via `t.raw()`. Re-declare the
 * shape locally so it accepts those array values — without this,
 * `Messages extends AbstractIntlMessages` is `false`, `IntlMessages`
 * collapses to `never`, and every dependent type (form namespaces, etc.)
 * resolves to `never` and the build fails.
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
