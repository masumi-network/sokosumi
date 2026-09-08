import assert from "node:assert/strict";
import test from "node:test";

import { parseCategory } from "../../src/api/models/category.js";
import {
  parseCoworker,
  parseCoworkerApiKey,
} from "../../src/api/models/coworker.js";
import { parseJobEvent } from "../../src/api/models/job-event.js";
import { parseJobFile, parseJobLink } from "../../src/api/models/job-output.js";
import { parseTask } from "../../src/api/models/task.js";
import { parseUser } from "../../src/api/models/user.js";

test("new Core models tolerate unexpected values with sibling defaults", () => {
  assert.deepEqual(parseCoworker(null), {
    id: null,
    createdAt: null,
    updatedAt: null,
    archivedAt: null,
    priority: 0,
    slug: null,
    name: null,
    caption: null,
    company: null,
    companyLogo: null,
    url: null,
    baseURL: null,
    email: null,
    description: null,
    image: null,
    metadata: null,
    status: null,
    isNew: false,
    isShown: false,
    isWhitelisted: false,
    price: { credits: null, includedFee: null },
    capabilities: [],
    estimatedDuration: null,
  });
  assert.deepEqual(parseCategory(null), {
    id: null,
    name: null,
    description: null,
    slug: null,
    agentCount: 0,
  });
  assert.equal(parseTask(null).jobs.length, 0);
  assert.deepEqual(parseJobEvent(null), {
    id: null,
    jobId: null,
    type: null,
    message: null,
    data: null,
    createdAt: null,
  });
  assert.equal(parseJobFile(null).url, null);
  assert.equal(parseJobLink(null).url, null);
  assert.equal(parseCoworkerApiKey(null).token, null);
  assert.equal(parseUser(null).email, null);
});

test("job file parser prefers fileUrl and falls back to sourceUrl", () => {
  assert.equal(
    parseJobFile({
      fileUrl: "https://blob/file",
      sourceUrl: "https://source/file",
    }).url,
    "https://blob/file",
  );
  assert.equal(
    parseJobFile({ sourceUrl: "https://source/file" }).url,
    "https://source/file",
  );
});
