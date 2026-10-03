# ADR 0051: Auth pages use underlined fields

- Status: Accepted
- Date: 2026-10-03
- Relates to: [ADR 0049](0049-email-codes-replace-magic-links.md), [ADR 0050](0050-password-sign-up-proves-the-address.md)

Logging in, signing up and resetting a password ask one question per step. Every step shares one layout (`AuthStepLayout` in `apps/web/src/app/(auth)/components/`): an optional back link to the product that asked for the log-in, a title that says what to do, an optional subtitle, the address as a rounded chip that goes back to change it, an optional notice line, the step's one field, a status line that is empty until something is checked or refused, and one row of links for the ways out. The field on these steps is underlined, not boxed: one large, centred field with a two-pixel bottom line that turns primary on focus and destructive on error. The email code is six underlined digit slots (`InputOTP`'s `underlined` variant), and a text field is `Input`'s `underlined` variant (`PasswordInput` passes it through). The app's boxed `Input` stays everywhere else.

The steps move one at a time: Log in's code step first, then its password step and the re-authentication dialog, step 1 of Log in and Register, sign-up step 2, and forgot and reset password. Until a step moves, it keeps its boxed field.

- **Underlined, not boxed, on auth only.** A boxed field under a visible label reads as one row of a form. A step with one question needs no label: the title and the placeholder name it, and the field keeps an accessible name. The app's own forms often have several fields, where boxes and labels group and separate them, so they keep them.
- **Equal side padding.** An underlined text field pads both sides by about 48px. The centred text then stays centred and never runs under a password manager's inline icon (1Password's is about 60px wide at the right edge) or the password's show/hide control.
- **Semantic tokens only.** The bottom line uses `input`, `primary` and `destructive`, so both themes follow without new tokens.
- **No submit button on Log in's code step.** The code already logs in on its sixth digit. The status line says "Checking the code…", the reason for a refusal (the slots shake once and clear), or that the code was accepted while the page leaves.

## Considered Options

- **Keep the boxed `Input` on auth pages.** Consistent with the app, but every step keeps reading as a form, and the code and password steps keep looking like two pages.
- **Underline every field in the app.** One look everywhere, but dense forms such as account settings lose the grouping boxes give them.
- **Floating labels on the underlined field.** They keep the name visible while typing, but add motion and height for steps that ask one thing under a title that already names it.

## Consequences

- Two field looks exist in the web app. A new auth step uses the underlined field and `AuthStepLayout`; anything outside auth and the re-authentication dialog uses `Input`.
- Every email code field is underlined now, so `InputOTP` has no boxed variant and the labelled `EmailCodeField` is gone. The shared name fields (`FirstAndLastNameFields`) take an `underlined` variant for sign-up and stay boxed in account settings and setup.
- Layout and the underline are not unit-tested. Each change proves them with real-browser screenshots in light and dark mode, at desktop width and at 375px.
