import {
  MessageKeys,
  NamespaceKeys,
  NestedKeyOf,
  NestedValueOf,
} from "next-intl";
import { z, ZodSchema } from "zod";

type FormData<
  T extends z.infer<ZodSchema>,
  Path extends NamespaceKeys<IntlMessages, NestedKeyOf<IntlMessages>>,
> = Array<{
  name: keyof T;
  type?: React.HTMLInputTypeAttribute;
  labelKey?: MessageKeys<
    NestedValueOf<IntlMessages, Path>,
    NestedKeyOf<NestedValueOf<IntlMessages, Path>>
  >;
  placeholderKey?: MessageKeys<
    NestedValueOf<IntlMessages, Path>,
    NestedKeyOf<NestedValueOf<IntlMessages, Path>>
  >;
  descriptionKey?: MessageKeys<
    NestedValueOf<IntlMessages, Path>,
    NestedKeyOf<NestedValueOf<IntlMessages, Path>>
  >;
}>;

export type { FormData };
