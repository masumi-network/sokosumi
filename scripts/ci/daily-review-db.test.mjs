import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertReviewBranch,
  productionParent,
  REVIEW_BRANCH,
  readerUri,
} from "./daily-review-db.mjs";

const production = {
  id: "br-prod",
  name: "main",
  default: true,
  protected: true,
};

test("the copy comes only from the protected default branch", () => {
  assert.equal(
    productionParent([{ id: "x", name: "preview/a" }, production]),
    production,
  );
  assert.throws(
    () => productionParent([{ ...production, protected: false }]),
    /must be protected/,
  );
  assert.throws(
    () =>
      productionParent([
        { id: "p", name: "preview/x", default: true, protected: true },
      ]),
    /No production parent/,
  );
  assert.throws(() => productionParent([]), /No production parent/);
});

test("a restore only ever replaces the review copy of production", () => {
  const review = { name: REVIEW_BRANCH, parent_id: "br-prod" };
  assert.doesNotThrow(() => assertReviewBranch(review, production));
  assert.throws(
    () => assertReviewBranch({ ...review, name: "main" }, production),
    /Refusing to restore "main"/,
  );
  assert.throws(
    () => assertReviewBranch({ ...review, protected: true }, production),
    /protected/,
  );
  assert.throws(
    () => assertReviewBranch({ ...review, parent_id: "br-other" }, production),
    /unexpected parent/,
  );
});

test("the reader URL keeps the host and database and swaps the role", () => {
  const uri = readerUri(
    "postgresql://neondb_owner:secret@ep-x.eu.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    "p/w+",
  );
  const url = new URL(uri);
  assert.equal(url.username, "daily_review");
  assert.equal(decodeURIComponent(url.password), "p/w+");
  assert.equal(url.host, "ep-x.eu.aws.neon.tech");
  assert.equal(url.pathname, "/neondb");
  assert.equal(url.searchParams.get("sslmode"), "require");
  assert.ok(!uri.includes("secret"));
});
