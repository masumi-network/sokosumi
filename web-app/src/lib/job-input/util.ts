import { JobInputType, JobInputValidationType } from "./type";

export function isTypeAndValidationValid(
  type: JobInputType,
  validation: JobInputValidationType,
): boolean {
  switch (validation) {
    case "min":
    case "max": {
      return type === "string" || type === "number" || type === "option";
    }
    case "format": {
      return type === "string" || type === "number";
    }
    case "required":
      return type !== "none";
  }
}
