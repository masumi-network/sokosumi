import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { badRequest } from "@/helpers/error";
import { FreeCreditValidationError } from "@/services/free-credit-admin.service";

export function mapFreeCreditError(error: unknown): never {
  if (error instanceof FreeCreditValidationError) {
    throw badRequest(error.message, {
      kind: CORE_API_ERROR_KINDS.FREE_CREDIT_INVALID,
    });
  }

  throw error;
}
