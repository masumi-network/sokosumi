import assert from "node:assert/strict";
import test from "node:test";

import { renderOAuthCallbackPage } from "../../src/auth/oauth-callback-page.js";

for (const isValid of [true, false]) {
  test(`callback page is self-contained (${isValid ? "valid" : "invalid"})`, () => {
    const html = renderOAuthCallbackPage(isValid);
    assert.match(html, /<html lang="en">/u);
    assert.match(html, /name="viewport"/u);
    assert.match(html, /name="referrer" content="no-referrer"/u);
    assert.match(html, /history\.replaceState/u);
    assert.match(html, /data:image\/svg\+xml;base64,/u);
    assert.match(html, /prefers-color-scheme:dark/u);
    assert.match(html, /aria-label="Next steps"/u);
    assert.doesNotMatch(html, /(?:src|href)="https?:|@import|@font-face/u);
    assert.doesNotMatch(html, /sign-in completed|signed in|window\.close/u);
    assert.match(
      html,
      isValid
        ? /<h1>Return to your terminal<\/h1>/u
        : /<h1>Sign-in could not continue<\/h1>/u,
    );
  });
}
