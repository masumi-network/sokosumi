/**
 * Renders the LinkedIn "Post as" page picker in every state, plus a company
 * page account row, as static HTML with fake data for screenshots.
 *
 *   cd apps/web
 *   pnpm exec tsx scripts/render-linkedin-company-pages.tsx > /tmp/linkedin-pages.html
 *   pnpm exec tsx scripts/render-linkedin-company-pages.tsx permission > /tmp/linkedin-pages-permission.html
 *
 * The optional argument picks one picker state: `available` (default),
 * `loading`, `empty`, `permission` or `error`. Wrap the output with the app's
 * compiled CSS the same way as the other `render-social-*` scripts.
 *
 * Avatars load client-side in the app, so static markup draws the picker's
 * logos as the LinkedIn fallback circle; the account row below draws the
 * loaded state (logo with the LinkedIn badge) directly.
 */
import type {
  ProjectSocialConnection,
  ProjectSocialConnectionPage,
} from "@sokosumi/core-client";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SocialAccountPageList,
  type SocialAccountPageListState,
} from "@/app/projects/components/social-account-page-list";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Badge } from "@/components/ui/badge";
import en from "../messages/en.json";

const variant = process.argv[2] ?? "available";

const EXAMPLE_LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" rx="12" fill="#1e3a8a"/><path d="M18 46V18h22v6H25v5h13v6H25v5h15v6z" fill="#f8fafc"/></svg>`,
  );

const PERSON: ProjectSocialConnection = {
  id: "00000000-0000-4000-8000-000000000001",
  provider: "linkedin",
  externalHandle: null,
  displayName: "Alex Example",
  avatarUrl: null,
  subscriptionType: null,
  accountType: "personal",
  status: "active",
  connectedAt: new Date("2026-10-26T10:00:00.000Z"),
  disconnectedAt: null,
};

const PAGES: ProjectSocialConnectionPage[] = [
  {
    externalAccountId: "urn:li:organization:1000001",
    name: "Example Company",
    handle: "example-company",
    logoUrl: EXAMPLE_LOGO,
    socialConnectionId: null,
  },
  {
    externalAccountId: "urn:li:organization:1000002",
    name: "Example Labs",
    handle: "example-labs",
    logoUrl: null,
    socialConnectionId: "00000000-0000-4000-8000-000000000002",
  },
];

const STATES: Record<string, SocialAccountPageListState> = {
  available: { kind: "available", pages: PAGES },
  loading: { kind: "loading" },
  empty: { kind: "available", pages: [] },
  permission: { kind: "permission_missing" },
  error: { kind: "error" },
};

const state = STATES[variant];
if (!state) {
  throw new Error(
    `Unknown state "${variant}". Use ${Object.keys(STATES).join(", ")}.`,
  );
}

const t = en.App.Projects.ProjectSocialAccounts;

/** The accounts list row for an added page, with its logo loaded. */
function CompanyPageAccountRow() {
  return (
    <ul className="divide-y rounded-lg border">
      <li className="flex flex-wrap items-center gap-3 p-3">
        <span className="relative size-6 shrink-0">
          <span className="relative flex size-6 shrink-0 overflow-hidden rounded-full">
            <img
              alt=""
              className="absolute inset-0 aspect-square size-full object-cover"
              src={EXAMPLE_LOGO}
            />
          </span>
          <span className="bg-background ring-background absolute end-0 bottom-0 flex size-3 items-center justify-center rounded-full ring-1">
            <SocialPostProviderIcon
              aria-hidden
              className="size-2"
              provider="linkedin"
            />
          </span>
        </span>
        <div className="min-w-40 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="min-w-0 truncate">Example Company</span>
            <Badge variant="secondary">{t.linkedInPages.companyPage}</Badge>
          </p>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            <span>{t.account.replace("{provider}", "LinkedIn")}</span>
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="bg-semantic-success size-1.5 rounded-full"
              />
              {t.status.active}
            </span>
          </p>
        </div>
      </li>
    </ul>
  );
}

process.stdout.write(
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <div className="bg-background w-full max-w-lg space-y-6 p-6">
        <section className="space-y-4 rounded-lg border p-6 shadow-lg">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t.linkedInPages.title}</h2>
            <p className="text-muted-foreground text-sm">
              {t.linkedInPages.connectHint}
            </p>
          </div>
          <SocialAccountPageList
            connection={PERSON}
            state={state}
            onAdd={() => {}}
            onRetry={() => {}}
          />
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t.title}</h2>
          <CompanyPageAccountRow />
        </section>
      </div>
    </NextIntlClientProvider>,
  ),
);
