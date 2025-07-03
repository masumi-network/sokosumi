import { AuthErrorCode } from "./auth";
import { BillingErrorCode } from "./billing";
import { CommonErrorCode } from "./common";
import { JobErrorCode } from "./job";
import { OrganizationErrorCode } from "./organization";

export {
  AuthErrorCode,
  BillingErrorCode,
  CommonErrorCode,
  JobErrorCode,
  OrganizationErrorCode,
};
export type ActionErrorCode =
  | CommonErrorCode
  | BillingErrorCode
  | JobErrorCode
  | OrganizationErrorCode
  | AuthErrorCode;
