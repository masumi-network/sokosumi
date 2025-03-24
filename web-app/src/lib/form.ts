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

export type { FormData };

interface ErrorMapOptions {
  tSchema: (key: string) => string;
}

export function createErrorMap({ tSchema }: ErrorMapOptions): z.ZodErrorMap {
  return (issue: z.ZodIssueOptionalMessage, ctx: z.ErrorMapCtx) => {
    const path = issue.path.join(".");
    switch (path) {
      case "email":
        if (issue.code === z.ZodIssueCode.invalid_string) {
          return { message: tSchema("Email.invalid") };
        }
        break;
      case "name":
        if (issue.code === z.ZodIssueCode.too_big) {
          return { message: tSchema("Name.max") };
        }
        if (issue.code === z.ZodIssueCode.too_small) {
          return { message: tSchema("Name.min") };
        }
        if (issue.code === z.ZodIssueCode.invalid_string) {
          return { message: tSchema("Name.invalid") };
        }
        break;
      case "currentPassword":
        if (issue.code === z.ZodIssueCode.too_small) {
          return { message: tSchema("Password.required") };
        }
        break;
      case "password":
      case "newPassword":
        if (issue.code === z.ZodIssueCode.invalid_string) {
          return { message: tSchema("Password.invalid") };
        }
        if (issue.code === z.ZodIssueCode.too_small) {
          return { message: tSchema("Password.min") };
        }
        if (issue.code === z.ZodIssueCode.too_big) {
          return { message: tSchema("Password.max") };
        }
        if (issue.code === z.ZodIssueCode.custom) {
          const { lowercase, uppercase, number } = issue.params ?? {};
          if (lowercase) return { message: tSchema("Password.lowercase") };
          if (uppercase) return { message: tSchema("Password.uppercase") };
          if (number) return { message: tSchema("Password.number") };
        }
        break;
      case "confirmPassword":
      case "confirmNewPassword":
        if (issue.code === z.ZodIssueCode.custom) {
          return { message: tSchema("ConfirmPassword.match") };
        }
        break;
    }
    return { message: ctx.defaultError };
  };
}
