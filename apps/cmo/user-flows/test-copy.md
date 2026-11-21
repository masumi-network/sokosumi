# Daily test copy

**Who:** the tester (CodePat), a member of the business's organization on both CMO allowlists, checking CMO end to end on a real business each day ([ADR 0073](../../../docs/adr/0073-a-cmo-test-copy-links-its-sources-connected-accounts.md)).

**Steps**

1. Opens `/?hire=1&testCopyOf=<the real Cuso's Project id>` and gives the same website. The form says "Test copy" and does not ask where he goes.
2. Goes through Research, Brand and Strategy, and approves the strategy (whoever made a copy may).
3. On Subscribe, continues without a subscription (Tester credits).
4. Launch shows the real Cuso's networks as connected already. Presses Launch.
5. Lets the month be made, reads the Calendar, sends commands in chat.
6. Tears him down: Start over in Settings, or `POST /api/test-copy?project=<id>`. Then `GET /api/test-copy?project=<id>`.

**They expect**

- No sign-in to any network, and Analytics and Search Console readable.
- Posts scheduled 12 hours ahead or later on the real accounts; the ones planned sooner stay drafts.
- Refused, with the reason: approving a draft that has no time, Post now, a comment reply, anything with ads, connecting an account.
- After the teardown: `clean: true`, `publishedPosts: 0`, `providerRevocations: 0`, and the real Cuso exactly as before.
- A copy nobody tears down is gone within ten hours and ten minutes.
- The SEO tab shows the real Cuso's latest audit. A copy starts an audit of its own only when none ran for the site in the last seven days.

**Today:** ad accounts are not linked, so a copy shows none. A copy has no published posts, so it has no comments to answer and no post statistics.
