import { MessageKeys, NestedKeyOf, NestedValueOf } from "next-intl";
import * as z from "zod";
import { ZodSchema } from "zod";

type EndsWithFormString<T extends string> = T extends `${infer _Key}.Form`
  ? T
  : never;

type FormIntlNamespaceKeys = EndsWithFormString<IntlNamespaceKeys>;

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
  disabled?: boolean;
}>;

export type { FormData };
