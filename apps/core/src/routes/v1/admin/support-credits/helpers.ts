import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { badRequest } from "@/helpers/error";
import { SupportCreditValidationError } from "@/services/support-credit-admin.service";

export function mapSupportCreditError(error: unknown): never {
  if (error instanceof SupportCreditValidationError) {
    throw badRequest(error.message, {
      kind: CORE_API_ERROR_KINDS.SUPPORT_CREDIT_INVALID,
    });
  }

  throw error;
}
