export const PERSONAL_WORKSPACE_MISSING_ERROR = "PERSONAL_WORKSPACE_MISSING";

export class PersonalWorkspaceMissingError extends Error {
  readonly code = PERSONAL_WORKSPACE_MISSING_ERROR;

  constructor() {
    super("Personal workspace is missing");
    this.name = "PersonalWorkspaceMissingError";
  }
}

export function isPersonalWorkspaceMissingError(error: unknown): boolean {
  if (error instanceof PersonalWorkspaceMissingError) {
    return true;
  }

  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === PERSONAL_WORKSPACE_MISSING_ERROR
  );
}
