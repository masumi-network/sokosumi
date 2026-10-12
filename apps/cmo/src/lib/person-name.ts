import {
  isFirstAndLastNameWithinLimit,
  USER_NAME_MAX_LENGTH,
} from "@sokosumi/utils";

export interface PersonNameErrors {
  firstName?: string;
  lastName?: string;
}

/**
 * Web's and Core's rule for a first and last name: both parts, and a joined
 * name Sokosumi can store. Empty when the name is valid.
 */
export function personNameErrors(
  firstName: string,
  lastName: string,
): PersonNameErrors {
  const errors: PersonNameErrors = {};
  if (!firstName.trim()) errors.firstName = "Enter your first name.";
  if (!lastName.trim()) errors.lastName = "Enter your last name.";
  if (
    !errors.firstName &&
    !errors.lastName &&
    !isFirstAndLastNameWithinLimit(firstName, lastName)
  ) {
    // On Last name, as Web and Core report it. The limit counts the space.
    errors.lastName = `Use up to ${USER_NAME_MAX_LENGTH - 1} characters for both names together.`;
  }
  return errors;
}

/** The name is valid, so the gate need not ask for it. */
export function isValidPersonName(
  firstName: string,
  lastName: string,
): boolean {
  return Object.keys(personNameErrors(firstName, lastName)).length === 0;
}
