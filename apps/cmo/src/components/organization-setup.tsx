"use client";

import { useActionState } from "react";

import type { OrganizationFormState } from "../app/workspace-actions";
import { Mascot } from "./mascot";
import { SubmitButton } from "./submit-button";

interface OrganizationSetupProps {
  createOrganizationWorkspace: (
    previous: OrganizationFormState,
    formData: FormData,
  ) => Promise<OrganizationFormState>;
}

const INITIAL_STATE: OrganizationFormState = {
  attempt: 0,
  name: "",
  websiteUrl: "",
  errors: {},
};

/** Tells assistive tech which messages describe a field. */
function describedBy(...ids: (string | false)[]): string | undefined {
  return ids.filter(Boolean).join(" ") || undefined;
}

/**
 * The workspace gate's organization step (ADR 0051): the organization's name
 * and website. Errors sit by their fields and what was typed stays.
 */
export function OrganizationSetup({
  createOrganizationWorkspace,
}: OrganizationSetupProps) {
  const [state, formAction] = useActionState(
    createOrganizationWorkspace,
    INITIAL_STATE,
  );
  const { errors } = state;

  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>Set up your organization.</h1>
        {errors.form ? <p role="alert">{errors.form}</p> : null}
        {/* A form resets after its action; remounting shows the kept values. */}
        <form key={state.attempt} className="fields" action={formAction}>
          <div className="field">
            <label htmlFor="organization-name">Organization name</label>
            <input
              id="organization-name"
              name="name"
              required
              minLength={2}
              maxLength={50}
              autoComplete="organization"
              defaultValue={state.name}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy(
                !!errors.name && "organization-name-error",
              )}
            />
            {errors.name ? (
              <p id="organization-name-error" className="field-error">
                {errors.name}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="organization-website">Website</label>
            <input
              id="organization-website"
              name="websiteUrl"
              required
              inputMode="url"
              autoComplete="url"
              aria-describedby={describedBy(
                "organization-website-hint",
                !!errors.websiteUrl && "organization-website-error",
              )}
              defaultValue={state.websiteUrl}
              aria-invalid={errors.websiteUrl ? true : undefined}
            />
            <p id="organization-website-hint" className="note">
              Your company's website, like acme.com.
            </p>
            {errors.websiteUrl ? (
              <p id="organization-website-error" className="field-error">
                {errors.websiteUrl}
              </p>
            ) : null}
          </div>
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
