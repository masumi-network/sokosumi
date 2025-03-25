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
  t: IntlTranslation<"Auth.Schema">;
}

export function createErrorMap({ t }: ErrorMapOptions): z.ZodErrorMap {
  return (issue: z.ZodIssueOptionalMessage, ctx: z.ErrorMapCtx) => {
    const path = issue.path.join(".");
    switch (path) {
      case "email":
        if (issue.code === z.ZodIssueCode.invalid_string) {
          return { message: t("Email.invalid") };
        }
        break;
      case "name":
        if (issue.code === z.ZodIssueCode.too_big) {
          return { message: t("Name.max") };
        }
        if (issue.code === z.ZodIssueCode.too_small) {
          return { message: t("Name.min") };
        }
        if (issue.code === z.ZodIssueCode.invalid_string) {
          return { message: t("Name.invalid") };
        }
        break;
      case "currentPassword":
        if (issue.code === z.ZodIssueCode.too_small) {
          return { message: t("Password.required") };
        }
        break;
      case "password":
      case "newPassword":
        if (issue.code === z.ZodIssueCode.invalid_string) {
          return { message: t("Password.invalid") };
        }
        if (issue.code === z.ZodIssueCode.too_small) {
          return { message: t("Password.min") };
        }
        if (issue.code === z.ZodIssueCode.too_big) {
          return { message: t("Password.max") };
        }
        if (issue.code === z.ZodIssueCode.custom) {
          const { lowercase, uppercase, number } = issue.params ?? {};
          if (lowercase) return { message: t("Password.lowercase") };
          if (uppercase) return { message: t("Password.uppercase") };
          if (number) return { message: t("Password.number") };
        }
        break;
      case "confirmPassword":
      case "confirmNewPassword":
        if (issue.code === z.ZodIssueCode.too_small) {
          return { message: t("ConfirmPassword.required") };
        }
        if (issue.code === z.ZodIssueCode.custom) {
          return { message: t("ConfirmPassword.match") };
        }
        break;
    }
    return { message: ctx.defaultError };
  };
}
