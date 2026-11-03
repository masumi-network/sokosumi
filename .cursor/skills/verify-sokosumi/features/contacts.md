# Contacts

Contacts lets a signed-in user open `/contacts` and see the team's people, including an empty list.

## Sub-features

- `contacts-open` loads `/contacts` while authenticated.
- `contacts-views` shows **All contacts**, **My contacts**, and **Recently added**.
- `contacts-list-or-empty` shows people or the empty heading **Your team's contacts live here**. The zero count reads **No people**; that count is not the heading.
- `contacts-gated` is covered by the shared app auth gate (anonymous users bounce to sign-in).

## How to get to it (user POV)

- Choose **Contacts** in the desktop sidebar **Records** group (with **Files**). **Schedules** is under **Work**. **Content Studio** is under **Marketing**.
- Open `/contacts` directly.

## Driving it with agent-browser

Preconditions:

- Signed in (see [Sign in](./sign-in.md)).
- `verify-sokosumi doctor` ok.

- **Open contacts.** Run `agent-browser open $WEB_URL/contacts` then `agent-browser wait --load networkidle` and `agent-browser snapshot -i`. URL stays `/contacts` (not `/signin`).
- **Confirm shell.** Snapshot shows **All contacts** / **My contacts** / **Recently added**, plus **Add contact**. Empty heading **Your team's contacts live here** is success. **Add someone** and **Import from a table** may be present. Do not require a populated grid.
- **Proof.** `mkdir -p .cursor/verify-sokosumi-artifacts/contacts` then screenshot + snapshot.

## Gotchas

- Empty contacts is valid for a fixture user. People are filled from mail, calendar, and Slack connections on Soko Bots, not by this landing check.
- **Lists** and **Companies** are adjacent chrome. Opening them is out of scope.
- This is not the account menu. The sidebar label is **Contacts**.
