import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");

/** Dynamic APIs that must not appear in Instant loading shell *code*. */
const DYNAMIC_SHELL_API_RE =
  /\bcookies\s*\(|\bconnection\s*\(|\bgetTranslations\s*\(|\bgetSession\s*\(/;

function readApp(rel: string): string {
  return readFileSync(join(appDir, rel), "utf8");
}

/** Drop comments so "no connection()" docs do not false-positive the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const pages = [
  "notifications/page.tsx",
  "connections/page.tsx",
  "developer/page.tsx",
  "developer/api-keys/page.tsx",
  "developer/oauth-clients/page.tsx",
  "developer/docs/page.tsx",
  "developer/coworkers/page.tsx",
  "developer/coworkers/[id]/page.tsx",
  "developer/tasks/page.tsx",
  "developer/tasks/[taskId]/page.tsx",
  "developer/vendors/page.tsx",
  "developer/vendors/[id]/page.tsx",
] as const;

const cardSectionLoadings = [
  "developer/api-keys/loading.tsx",
  "developer/oauth-clients/loading.tsx",
  "developer/docs/loading.tsx",
] as const;

const listSectionLoadings = [
  "developer/coworkers/loading.tsx",
  "developer/tasks/loading.tsx",
  "developer/vendors/loading.tsx",
] as const;

const formDetailLoadings = [
  "developer/coworkers/[id]/loading.tsx",
  "developer/vendors/[id]/loading.tsx",
] as const;

const taskDetailLoading = "developer/tasks/[taskId]/loading.tsx" as const;

const hubLoadings = [
  "notifications/loading.tsx",
  "connections/loading.tsx",
  ...cardSectionLoadings,
  ...listSectionLoadings,
  ...formDetailLoadings,
  taskDetailLoading,
] as const;

const shellViews = [
  "notifications/components/notifications-loading-view.tsx",
  "connections/components/connections-loading-view.tsx",
  "developer/components/developer-loading-view.tsx",
] as const;

describe("hub Instant Nav skeleton contract", () => {
  for (const rel of pages) {
    it(`${rel} does not soft-nav opt out of Instant`, () => {
      const source = readApp(rel);
      expect(source).not.toMatch(/export\s+const\s+instant\s*=\s*false/);
    });
  }

  for (const rel of [...hubLoadings, ...shellViews]) {
    it(`${rel} stays sync (no cookies/connection/session/i18n)`, () => {
      const code = stripComments(readApp(rel));
      expect(code).not.toMatch(DYNAMIC_SHELL_API_RE);
    });
  }

  it("notifications/loading.tsx returns NotificationsPageSkeleton", () => {
    const code = stripComments(readApp("notifications/loading.tsx"));
    expect(code).toMatch(
      /export\s+default\s+function[\s\S]*?return\s+<\s*NotificationsPageSkeleton\s*\/>/,
    );
  });

  it("connections/loading.tsx returns ConnectionsPageSkeleton", () => {
    const code = stripComments(readApp("connections/loading.tsx"));
    expect(code).toMatch(
      /export\s+default\s+function[\s\S]*?return\s+<\s*ConnectionsPageSkeleton\s*\/>/,
    );
  });

  for (const rel of cardSectionLoadings) {
    it(`${rel} returns DeveloperSectionPageSkeleton`, () => {
      const code = stripComments(readApp(rel));
      expect(code).toMatch(
        /export\s+default\s+function[\s\S]*?return\s+<\s*DeveloperSectionPageSkeleton\s*\/>/,
      );
    });
  }

  for (const rel of listSectionLoadings) {
    it(`${rel} returns DeveloperListPageSkeleton`, () => {
      const code = stripComments(readApp(rel));
      expect(code).toMatch(
        /export\s+default\s+function[\s\S]*?return\s+<\s*DeveloperListPageSkeleton\s*\/>/,
      );
    });
  }

  for (const rel of formDetailLoadings) {
    it(`${rel} returns DeveloperDetailPageSkeleton`, () => {
      const code = stripComments(readApp(rel));
      expect(code).toMatch(
        /export\s+default\s+function[\s\S]*?return\s+<\s*DeveloperDetailPageSkeleton\s*\/>/,
      );
    });
  }

  it(`${taskDetailLoading} returns DeveloperTaskDetailPageSkeleton`, () => {
    const code = stripComments(readApp(taskDetailLoading));
    expect(code).toMatch(
      /export\s+default\s+function[\s\S]*?return\s+<\s*DeveloperTaskDetailPageSkeleton\s*\/>/,
    );
  });

  it("developer root has no loading.tsx (redirect-only segment)", () => {
    expect(() => readApp("developer/loading.tsx")).toThrow();
  });
});
