import { ValidationSchemaType } from "@sokosumi/masumi/schemas";
import { InputValidation } from "@sokosumi/masumi/types";

import { OptionSelectMode } from "@/lib/job-input/form-schema-helpers";

export function getOptionSelectMode(
  validations: ValidationSchemaType[] | null | undefined,
): OptionSelectMode {
  if (!validations) return "single";

  const minValidation = validations.find(
    ({ validation }) => validation === InputValidation.MIN,
  );
  const maxValidation = validations.find(
    ({ validation }) => validation === InputValidation.MAX,
  );

  if (!minValidation && !maxValidation) return "single";

  if (
    minValidation &&
    maxValidation &&
    Number(minValidation.value) === 1 &&
    Number(maxValidation.value) === 1
  ) {
    return "single";
  }

  return "multi";
}
