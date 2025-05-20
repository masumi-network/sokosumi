import { MessageKeys, NestedKeyOf, NestedValueOf } from "next-intl";
import { z, ZodType } from "zod/v4";

type EndsWithFormString<T extends string> = T extends `${infer _Key}.Form`
  ? T
  : never;

type FormIntlNamespaceKeys = EndsWithFormString<IntlNamespaceKeys>;

type MessageKeysIn<Path extends string> = MessageKeys<
  NestedValueOf<IntlMessages, Path>,
  NestedKeyOf<NestedValueOf<IntlMessages, Path>>
>;

type FormData<
  T extends z.infer<ZodType>,
  Path extends FormIntlNamespaceKeys,
> = Array<{
  name: keyof T;
  type?: React.HTMLInputTypeAttribute;
  labelKey?: MessageKeysIn<Path>;
  placeholderKey?: MessageKeysIn<Path>;
  descriptionKey?: MessageKeysIn<Path>;
}>;

export type { FormData };
