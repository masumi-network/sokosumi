import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defaultExclude, defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

function resolvePath(relativePath: string): string {
  return path.resolve(rootDir, relativePath);
}

/**
 * `.test.ts` files that render or hook into a DOM. Keep these on happy-dom;
 * every other `*.test.ts` under src runs in node.
 */
const DOM_TEST_TS = [
  "src/**/use-*.test.ts",
  "src/**/*.hook.test.ts",
  "src/components/data-table/**/*.test.ts",
  "src/components/chat/fetch-background-json.test.ts",
  "src/components/chat/fetch-room-messages.test.ts",
  "src/components/chat/fetch-sidebar-room-collection.test.ts",
  "src/components/chat/organization-chat-events.test.ts",
  "src/components/ui/mention-textarea-utils.test.ts",
  "src/contexts/notification-view-storage.test.ts",
  "src/lib/utils/notification-time.test.ts",
  "src/lib/utils/browser-notification.test.ts",
  "src/lib/utils/dom-context.test.ts",
  "src/lib/utils/dynamic-type.test.ts",
  "src/lib/utils/is-editable-keyboard-target.test.ts",
  "src/lib/utils/preference-storage.test.ts",
  "src/lib/utils/notification-service-worker.test.ts",
  "src/lib/utils/visual-viewport-keyboard.test.ts",
  "src/lib/utils/composer-*.test.ts",
  "src/lib/ui-preferences/sidebar-state.test.ts",
  "src/lib/analytics/consent.test.ts",
  "src/lib/auth/auth.utils.test.ts",
  "src/lib/auth/finish-auth.client.test.ts",
  "src/lib/auth/sign-out.client.test.ts",
  "src/lib/ably/**/*.client.test.ts",
  "src/lib/ably/__tests__/push-lifecycle-races.test.ts",
  "src/app/(app)/organization/page.test.ts",
  "src/app/(app)/projects/project-brand-job.test.ts",
  "src/app/(app)/tasks/components/task-navigation.test.ts",
  "src/app/(app)/tasks/components/tasks-empty-state-overlay.test.ts",
  "src/app/(app)/chat/components/__tests__/room-helpers-mentions.test.ts",
  "src/app/(app)/chat/components/__tests__/transcript-viewport-virtualizer-contract.test.ts",
  "src/app/(app)/chat/components/landing/nearest-center-coworker.test.ts",
  "src/app/(app)/chat/utils/compose-draft-storage.test.ts",
  "src/app/(app)/chat/utils/format-toolbar-preference-storage.test.ts",
  "src/app/(app)/chat/utils/pending-room-message.test.ts",
  "src/app/(app)/chat/utils/room-message-highlight.test.ts",
  "src/app/(app)/chat/utils/room-search-jump.test.ts",
  "src/app/__tests__/agent-fullbleed-activity-leak.harness.test.ts",
  "src/test/waapi-cancel-abort.test.ts",
] as const;

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: [
      {
        find: "server-only",
        replacement: resolvePath("./src/test/empty-module.ts"),
      },
      {
        find: /^@sokosumi\/masumi$/,
        replacement: resolvePath("../../packages/masumi/src/index.ts"),
      },
      {
        find: /^@sokosumi\/masumi\/(.*)$/,
        replacement: resolvePath("../../packages/masumi/src/$1"),
      },
      {
        find: /^@sokosumi\/utils$/,
        replacement: resolvePath("../../packages/utils/src/index.ts"),
      },
    ],
  },
  test: {
    passWithNoTests: true,
    setupFiles: ["src/test/setup.ts"],
    /**
     * Leave the machine half its cores. Vitest otherwise takes all but one,
     * and a happy-dom suite this size then starves WindowServer badly enough
     * that its watchdog kills it — the desktop freezes, which is worse than a
     * slower test run. Especially easy to hit when this suite, the Core suite
     * and a typecheck run at once. CI boxes are dedicated and small, so they
     * keep full parallelism.
     */
    maxWorkers: process.env.CI ? undefined : "50%",
    /**
     * Vitest 5 dropped `environmentMatchGlobs`. Two projects is the
     * equivalent: pure `.test.ts` files stay in node; `.tsx` and DOM/hook
     * `.test.ts` (Testing Library / window) stay on happy-dom.
     */
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...defaultExclude, ...DOM_TEST_TS],
        },
      },
      {
        extends: true,
        test: {
          name: "happy-dom",
          environment: "happy-dom",
          include: ["src/**/*.test.tsx", ...DOM_TEST_TS],
        },
      },
    ],
  },
});
