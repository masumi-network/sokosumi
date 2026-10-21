import type { MessageKeys, NestedKeyOf, NestedValueOf } from "next-intl";
import type * as z from "zod";
import type { ZodSchema } from "zod";

// Collect only form namespaces to avoid expanding the full message-key union.
type FormIntlNamespaceKeys<Messages = IntlMessages> = {
  [Key in keyof Messages & string]: Messages[Key] extends object
    ?
        | (Key extends "Form" ? Key : never)
        | `${Key}.${FormIntlNamespaceKeys<Messages[Key]>}`
    : never;
}[keyof Messages & string];

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
  autoComplete?: React.HTMLInputAutoCompleteAttribute;
  labelKey?: MessageKeysIn<Path>;
  placeholderKey?: MessageKeysIn<Path>;
  descriptionKey?: MessageKeysIn<Path>;
  disabled?: boolean;
}>;

export type { FormData };
