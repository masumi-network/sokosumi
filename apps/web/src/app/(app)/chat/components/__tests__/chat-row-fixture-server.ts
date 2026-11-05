/** Vite server for offline chat row fixtures opened in a real browser. */
import path from "node:path";

import { createServer, type ViteDevServer } from "vite";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

/** Serves `html` at `/` and transforms `pageModule` before returning. */
export async function startChatRowFixtureServer({
  pageModule,
  html,
  cacheDir,
}: {
  pageModule: string;
  html: string;
  /** One per suite, under `node_modules`. */
  cacheDir: string;
}): Promise<ViteDevServer> {
  const server = await createServer({
    // The app's own resolution and React plugin, read from its Vitest config.
    configFile: path.join(WEB_ROOT, "vitest.config.mts"),
    root: WEB_ROOT,
    cacheDir: path.join(WEB_ROOT, "node_modules", cacheDir),
    logLevel: "error",
    define: { "process.env": JSON.stringify({ NODE_ENV: "development" }) },
    plugins: [
      {
        name: "chat-row-fixture-page",
        enforce: "pre",
        // Mock navigation, presence and server mutation boundaries. Row,
        // receipts, attachment previews and CSS stay real in both runtimes.
        resolveId(id) {
          if (id === "next/navigation") return "\0fixture-navigation";
          if (id === "@/contexts/org-presence-provider")
            return "\0fixture-presence";
          if (id === "@/app/chat/actions") return "\0fixture-room-action";
          if (id === "@/lib/actions/soko-bot/action") return "\0fixture-action";
          if (id === "./select-project-action")
            return "\0fixture-project-action";
        },
        load(id) {
          if (id === "\0fixture-presence") {
            return `export const useMemberPresence = (_id, fallback) => fallback;`;
          }
          if (id === "\0fixture-room-action") {
            return `const forbidden = () => {throw new Error('Room actions forbidden in this fixture');};
              export const createDirectRoomAction = forbidden;
              export const ensureCoworkerDirectRoomAction = forbidden;
              export const ensureSokoBotDirectRoomAction = forbidden;`;
          }
          if (id === "\0fixture-navigation") {
            return `export const useRouter = () => ({push(){}, replace(){}, refresh(){}});
              export const usePathname = () => '/chat';
              export const useSearchParams = () => new URLSearchParams();
              export const redirect = () => {};
              export const unstable_rethrow = () => {};`;
          }
          if (id === "\0fixture-action") {
            return `const forbidden = () => {
              throw new Error('Server mutations are forbidden in this fixture');
            };
              export const sendSokoBotTurnFeedbackAction = forbidden;
              export const resolveSokoBotDecisionAction = forbidden;`;
          }
          if (id === "\0fixture-project-action") {
            return `export const selectChatProjectAction = () => {
              throw new Error('Server mutations are forbidden in this fixture');
            };`;
          }
        },
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url !== "/") return next();
            devServer
              .transformIndexHtml("/", html)
              .then((transformed) => {
                response.setHeader("content-type", "text/html");
                response.end(transformed);
              })
              .catch(next);
          });
        },
      },
    ],
    optimizeDeps: {
      entries: [pageModule.slice(1)],
      exclude: ["next/navigation"],
    },
    // A fixture never changes on disk while a case runs. Hot reload would
    // discard its SSR baseline if dependency optimization discovers an import.
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  await server.listen();
  // Transform the client graph before measuring SSR. Loading a new optimized
  // dependency during hydration would reload the page and erase the transition.
  await server.environments.client.warmupRequest(pageModule);
  await server.environments.client.waitForRequestsIdle();
  return server;
}
