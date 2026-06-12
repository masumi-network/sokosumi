import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { badRequest } from "@/helpers/error";
import { InvoiceValidationError } from "@/services/invoice-admin.service";

/**
 * Maps a `InvoiceValidationError` to a 400 with the stable
 * `invoice_invalid` kind; rethrows everything else for the generic
 * error handler.
 */
export function mapInvoiceError(error: unknown): never {
  if (error instanceof InvoiceValidationError) {
    throw badRequest(error.message, {
      kind: CORE_API_ERROR_KINDS.INVOICE_INVALID,
    });
  }

  throw error;
}
