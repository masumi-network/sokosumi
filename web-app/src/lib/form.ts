import {
  MessageKeys,
  NamespaceKeys,
  NestedKeyOf,
  NestedValueOf,
} from "next-intl";
import { z, ZodSchema } from "zod";

type EndsWithFormString<T extends string> = T extends `${infer _Key}.Form`
  ? T
  : never;

type FormIntlNamespaceKeys = EndsWithFormString<
  NamespaceKeys<IntlMessages, NestedKeyOf<IntlMessages>>
>;

type FormIntlTranslation<Path extends FormIntlNamespaceKeys> =
  IntlTranslation<Path>;

type MessageKeysIn<Path extends string> = MessageKeys<
  NestedValueOf<IntlMessages, Path>,
  NestedKeyOf<NestedValueOf<IntlMessages, Path>>
>;

type FormData<
  T extends z.infer<ZodSchema>,
  Path extends FormIntlNamespaceKeys,
> = Array<{
  name: keyof T;
  type?: React.HTMLInputTypeAttribute;
  labelKey?: MessageKeysIn<Path>;
  placeholderKey?: MessageKeysIn<Path>;
  descriptionKey?: MessageKeysIn<Path>;
}>;

export type { FormData, FormIntlTranslation };
