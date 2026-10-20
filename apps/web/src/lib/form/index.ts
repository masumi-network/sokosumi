import type { MessageKeys, NestedKeyOf, NestedValueOf } from "next-intl";
import type * as z from "zod";
import type { ZodSchema } from "zod";

type MessageKeysIn<Path extends string> = Path extends string
  ? MessageKeys<
      NestedValueOf<IntlMessages, Path>,
      NestedKeyOf<NestedValueOf<IntlMessages, Path>>
    >
  : never;

type FormData<
  T extends z.infer<ZodSchema>,
  Path extends `${string}.Form`,
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
