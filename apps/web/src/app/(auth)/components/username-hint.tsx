interface UsernameHintProps {
  /** Confirmed on the email step. */
  email: string;
}

/**
 * The address, hidden, inside a step's form: password managers pair the
 * password beside it with this account. Screen readers and Tab skip it; the
 * email chip above the form shows the address.
 */
export function UsernameHint({ email }: UsernameHintProps) {
  return (
    <input
      data-testid="auth-field-username"
      type="email"
      autoComplete="username"
      autoCapitalize="none"
      spellCheck={false}
      value={email}
      readOnly
      tabIndex={-1}
      aria-hidden="true"
      className="sr-only"
    />
  );
}
