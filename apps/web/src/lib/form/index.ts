import type { MessageKeys, NestedKeyOf, NestedValueOf } from "next-intl";
import type * as z from "zod";
import type { ZodSchema } from "zod";

// Find form namespaces without expanding every message path in the catalog.
type FormNamespaceKeys<Messages> = Messages extends object
  ? {
      [Key in keyof Messages & string]: Key extends "Form"
        ? Key
        : `${Key}.${FormNamespaceKeys<Messages[Key]>}`;
    }[keyof Messages & string]
  : never;

type FormIntlNamespaceKeys = FormNamespaceKeys<IntlMessages>;

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
