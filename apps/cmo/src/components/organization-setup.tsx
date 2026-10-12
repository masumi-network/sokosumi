"use client";

import { useActionState } from "react";

import type { OrganizationFormState } from "../app/workspace-actions";
import { FormAlert, FormField, useFocusFirstInvalid } from "./form-field";
import { Mascot } from "./mascot";
import { SubmitButton } from "./submit-button";

interface OrganizationSetupProps {
  createOrganizationWorkspace: (
    previous: OrganizationFormState,
    formData: FormData,
  ) => Promise<OrganizationFormState>;
  /** The website the sign-up link carried; the person confirms or edits it. */
  websiteUrl?: string;
}

const INITIAL_STATE: OrganizationFormState = {
  attempt: 0,
  name: "",
  websiteUrl: "",
  errors: {},
};

/**
 * The workspace gate's organization step (ADR 0051): the organization's name
 * and website. Errors sit by their fields and what was typed stays.
 */
export function OrganizationSetup({
  createOrganizationWorkspace,
  websiteUrl = "",
}: OrganizationSetupProps) {
  const [state, formAction] = useActionState(createOrganizationWorkspace, {
    ...INITIAL_STATE,
    websiteUrl,
  });
  const { errors } = state;
  const formRef = useFocusFirstInvalid(state.attempt);

  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>Set up your organization.</h1>
        {/* Remounts after each submit (useFocusFirstInvalid). */}
        <form
          key={state.attempt}
          ref={formRef}
          className="fields"
          action={formAction}
        >
          <FormAlert message={errors.form} />
          <FormField
            id="organization-name"
            name="name"
            label="Organization name"
            required
            minLength={2}
            maxLength={50}
            autoComplete="organization"
            defaultValue={state.name}
            error={errors.name}
          />
          <FormField
            id="organization-website"
            name="websiteUrl"
            label="Website"
            hint="Your company's website, like acme.com."
            required
            inputMode="url"
            autoComplete="url"
            defaultValue={state.websiteUrl}
            error={errors.websiteUrl}
          />
          <div className="actions">
            <SubmitButton className="button">Create organization</SubmitButton>
            <a className="button button-secondary" href="/">
              Back
            </a>
          </div>
        </form>
      </div>
      <Mascot className="hero-mascot" />
    </main>
  );
}
