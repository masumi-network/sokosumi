"use client";

import { useActionState } from "react";

import type { NameFormState } from "../app/name-actions";
import { FormAlert, FormField, useFocusFirstInvalid } from "./form-field";
import { Mascot } from "./mascot";
import { SubmitButton } from "./submit-button";

interface NameSetupProps {
  saveName: (
    previous: NameFormState,
    formData: FormData,
  ) => Promise<NameFormState>;
  signOut: () => Promise<void>;
}

const INITIAL_STATE: NameFormState = {
  attempt: 0,
  firstName: "",
  lastName: "",
  errors: {},
};

/**
 * The workspace gate's name step (ADR 0051), before the workspace choice,
 * for a person whose sign-up gave no valid first and last name.
 */
export function NameSetup({ saveName, signOut }: NameSetupProps) {
  const [state, formAction] = useActionState(saveName, INITIAL_STATE);
  const { errors } = state;
  const formRef = useFocusFirstInvalid(state.attempt);

  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>What is your name?</h1>
        {/* Remounts after each submit (useFocusFirstInvalid). One form, so
            pressing either button disables both; each has its own action,
            so only the one pressed spins. Sign out skips validation: the
            empty required fields would otherwise block leaving. */}
        <form key={state.attempt} ref={formRef} className="fields">
          <FormAlert message={errors.form} />
          <FormField
            id="first-name"
            name="firstName"
            label="First name"
            required
            autoComplete="given-name"
            defaultValue={state.firstName}
            error={errors.firstName}
          />
          <FormField
            id="last-name"
            name="lastName"
            label="Last name"
            required
            autoComplete="family-name"
            defaultValue={state.lastName}
            error={errors.lastName}
          />
          <div className="actions">
            <SubmitButton className="button" formAction={formAction}>
              Continue
            </SubmitButton>
            <SubmitButton
              className="button button-secondary"
              formAction={signOut}
              formNoValidate
            >
              Sign out
            </SubmitButton>
          </div>
        </form>
      </div>
      <Mascot className="hero-mascot" />
    </main>
  );
}
