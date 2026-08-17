import { isPersonalWorkspaceMissingError } from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { notFound } from "@/helpers/error";

export function rethrowPersonalWorkspaceMissing(error: unknown): never {
  if (isPersonalWorkspaceMissingError(error)) {
    throw notFound("Personal workspace is missing", {
      kind: CORE_API_ERROR_KINDS.PERSONAL_WORKSPACE_MISSING,
    });
  }

  throw error;
}
