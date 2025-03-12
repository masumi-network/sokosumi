import { AbstractIntlMessages, MessageKeys, NestedKeyOf } from "next-intl";
import { z, ZodSchema } from "zod";

type FormData<
  T extends z.infer<ZodSchema>,
  Messages extends AbstractIntlMessages,
> = Array<{
  name: keyof T;
  type?: React.HTMLInputTypeAttribute;
  labelKey?: MessageKeys<Messages, NestedKeyOf<Messages>>;
  placeholderKey?: MessageKeys<Messages, NestedKeyOf<Messages>>;
  descriptionKey?: MessageKeys<Messages, NestedKeyOf<Messages>>;
}>;

export type { FormData };
