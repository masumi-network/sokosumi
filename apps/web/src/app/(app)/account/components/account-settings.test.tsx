import type { Account } from "@sokosumi/utils";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSettings } from "./account-settings";

const deleteAccountFormProps = vi.fn();

vi.mock("./delete-account-form", () => ({
  DeleteAccountForm: (props: { hasPassword: boolean }) => {
    deleteAccountFormProps(props);
    return null;
  },
}));

// The rest of the page is out of scope here.
vi.mock("./account-billing-details", () => ({
  AccountBillingDetails: () => null,
}));
vi.mock("./account-coworker-access", () => ({
  AccountCoworkerAccess: () => null,
}));
vi.mock("./account-vendor-grants", () => ({ AccountVendorGrants: () => null }));
vi.mock("./brand-profile-section", () => ({ BrandProfileSection: () => null }));
vi.mock("./delete-personal-workspace-form", () => ({
  DeletePersonalWorkspaceForm: () => null,
}));
vi.mock("./email-form", () => ({ EmailForm: () => null }));
vi.mock("./name-form", () => ({ NameForm: () => null }));
vi.mock("./new-password-form", () => ({ NewPasswordForm: () => null }));
vi.mock("./passkey-settings", () => ({ PasskeySettings: () => null }));
vi.mock("./password-form", () => ({ PasswordForm: () => null }));
vi.mock("./preferences-section", () => ({ PreferencesSection: () => null }));
vi.mock("./profile-image-section", () => ({ ProfileImageSection: () => null }));

const googleAccount: Account = {
  accountId: "google-account",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "account-google",
  providerId: "google",
  updatedAt: "2026-01-01T00:00:00.000Z",
  userId: "user-1",
};

const passwordAccount: Account = {
  accountId: "credential-account",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "account-credential",
  providerId: "credential",
  updatedAt: "2026-01-01T00:00:00.000Z",
  userId: "user-1",
};

describe("AccountSettings account deletion", () => {
  beforeEach(() => {
    deleteAccountFormProps.mockClear();
  });

  it("confirms with the password when the viewer has one", () => {
    render(<AccountSettings accounts={[googleAccount, passwordAccount]} />);

    expect(deleteAccountFormProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasPassword: true }),
    );
  });

  it("confirms with the email when the viewer has no password", () => {
    render(<AccountSettings accounts={[googleAccount]} />);

    expect(deleteAccountFormProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasPassword: false }),
    );
  });

  /**
   * An unknown account list must not drop a password user onto the
   * passwordless path, which deletes on session age alone.
   */
  it("keeps the password when the accounts could not be read", () => {
    render(
      <AccountSettings
        accounts={[]}
        credentialAccountsLoadError={<p>Could not load accounts</p>}
      />,
    );

    expect(deleteAccountFormProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasPassword: true }),
    );
  });
});
