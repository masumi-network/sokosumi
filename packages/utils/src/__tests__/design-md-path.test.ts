import { describe, expect, it } from "vitest";

import {
  buildAdHocDesignMdPathname,
  buildAdHocDesignMdPrefix,
  buildOrganizationDesignMdPathname,
  buildOrganizationDesignMdPrefix,
  buildUserDesignMdPathname,
  buildUserDesignMdPrefix,
} from "../design-md-path.js";

const USER_ID = "user_123";
const ORG_ID = "01960001-0001-7001-8001-000000000099";
const HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("buildUserDesignMdPrefix", () => {
  it("returns design-md/users/{userId}/", () => {
    expect(buildUserDesignMdPrefix(USER_ID)).toBe(
      `design-md/users/${USER_ID}/`,
    );
  });
});

describe("buildOrganizationDesignMdPrefix", () => {
  it("returns design-md/organizations/{orgId}/", () => {
    expect(buildOrganizationDesignMdPrefix(ORG_ID)).toBe(
      `design-md/organizations/${ORG_ID}/`,
    );
  });
});

describe("buildUserDesignMdPathname", () => {
  it("appends the hash filename under the user design-md prefix", () => {
    expect(buildUserDesignMdPathname(USER_ID, `${HASH}.md`)).toBe(
      `design-md/users/${USER_ID}/${HASH}.md`,
    );
  });

  it("keeps an extractionId-prefixed hash filename", () => {
    expect(buildUserDesignMdPathname(USER_ID, `123-${HASH}.md`)).toBe(
      `design-md/users/${USER_ID}/123-${HASH}.md`,
    );
  });
});

describe("buildOrganizationDesignMdPathname", () => {
  it("appends the hash filename under the org design-md prefix", () => {
    expect(buildOrganizationDesignMdPathname(ORG_ID, `${HASH}.md`)).toBe(
      `design-md/organizations/${ORG_ID}/${HASH}.md`,
    );
  });

  it("keeps an extractionId-prefixed hash filename", () => {
    expect(buildOrganizationDesignMdPathname(ORG_ID, `55-${HASH}.md`)).toBe(
      `design-md/organizations/${ORG_ID}/55-${HASH}.md`,
    );
  });
});

describe("buildAdHocDesignMdPrefix", () => {
  it("returns design-md/adhoc/{userId}/", () => {
    expect(buildAdHocDesignMdPrefix(USER_ID)).toBe(
      `design-md/adhoc/${USER_ID}/`,
    );
  });
});

describe("buildAdHocDesignMdPathname", () => {
  it("appends the hash filename under the ad hoc design-md prefix", () => {
    expect(buildAdHocDesignMdPathname(USER_ID, `${HASH}.md`)).toBe(
      `design-md/adhoc/${USER_ID}/${HASH}.md`,
    );
  });

  it("keeps an extractionId-prefixed hash filename", () => {
    expect(buildAdHocDesignMdPathname(USER_ID, `99-${HASH}.md`)).toBe(
      `design-md/adhoc/${USER_ID}/99-${HASH}.md`,
    );
  });
});
