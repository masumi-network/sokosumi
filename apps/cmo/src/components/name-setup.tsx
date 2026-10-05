"use client";

import { useActionState } from "react";

import type { NameFormState } from "../app/name-actions";
import { FormField, useFocusFirstInvalid } from "./form-field";
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
        <h1>What should we call you?</h1>
        {/* Remounts after each submit (useFocusFirstInvalid). */}
        <form
          key={state.attempt}
          ref={formRef}
          className="fields"
          action={formAction}
        >
          {errors.form ? <p role="alert">{errors.form}</p> : null}
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
            <SubmitButton className="button">Continue</SubmitButton>
          </div>
        </form>
        {/* Its own form: Continue spins whenever its form runs. */}
        <form>
          <SubmitButton
            className="button button-secondary"
            formAction={signOut}
          >
            Sign out
          </SubmitButton>
        </form>
      </div>
      <Mascot className="hero-mascot" />
    </main>
  );
}
