"use client";

import type {
  CmoKeywordSearch,
  CmoSeo,
  CmoSeoEvidence,
  CmoSeoSuggestion,
} from "@sokosumi/core-client";
import { Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AGENT_NAME } from "../../lib/agent";
import { seoLead } from "../../lib/page-lead";
import {
  pageChangeCopy,
  plainIssueDetail,
  withoutAuditIds,
} from "../../lib/seo-copy";
import {
  changeText,
  NEXT_SHOWN,
  positionChangeText,
  type SeoStep,
  seoSteps,
} from "../../lib/seo-next";
import { DraftText } from "../draft-text";
import { LocalDay } from "../local-day";
import { StatusText } from "../status";
import { SubmitButton } from "../submit-button";
import { PageLead } from "./page-lead";

import { BeforeAfter, CopyButton } from "./seo-before-after";
import { KeywordSearch, SearchConsoleCard } from "./seo-research";
import { count, day, NOT_KNOWN, pagePath } from "./seo-research-format";

export interface SeoActions {
  loadSeo: () => Promise<CmoSeo | null>;
  searchKeywords: (
    topic: string,
  ) => Promise<{ search: CmoKeywordSearch | null; error: string | null }>;
  setSeoSuggestionStatus: (
    id: string,
    status: "open" | "done" | "dismissed",
  ) => Promise<string | null>;
  /** The owner published a landing page at this address on their site. */
  markLandingPageLive: (
    id: string,
    url: string,
  ) => Promise<{ note: string | null; error: string | null }>;
  /** No id: more article ideas, or with write one new article in full; an id: that article in full. */
  askCusoForArticles: (
    articleId?: string,
    write?: boolean,
  ) => Promise<string | null>;
  connectSearchConsole: () => Promise<{
    url: string | null;
    error: string | null;
  }>;
}

/** What writing one article costs: about $0.015 of model time in the cmo-v12 eval run (1,085 words), at 100 credits a dollar. */
const ARTICLE_COST = "Each article uses about 2 credits of your plan.";

/** While the tab is open it reads again this often, so Cuso's new ideas show up. */
const REFRESH_MS = 20_000;

const SOURCE: Record<CmoSeoEvidence["source"], string> = {
  keyword_research: "Keyword research",
  search_console: "Search Console",
  weekly_audit: "Weekly audit",
};

/** One number with what it is, for a search or a page. */
function evidenceText(e: CmoSeoEvidence): string {
  const on = e.keyword ? ` for "${e.keyword}"` : "";
  switch (e.metric) {
    case "searchVolume":
      return `${e.value} searches a month${on}`;
    case "difficulty":
      return `difficulty ${e.value} of 100`;
    case "intent":
      return `${e.value} intent`;
    case "position":
      return `${/^\d/.test(e.value) ? "position " : ""}${e.value}${on}`;
    case "clicks":
      return `${e.value} clicks${on}`;
    case "impressions":
      return `seen ${e.value} times${on}`;
    case "ctr":
      return `${e.value} clicked${on}`;
    case "auditIssue":
      return `did not pass the check "${withoutAuditIds(e.value)}"`;
  }
}

function Evidence({ items }: { items: CmoSeoEvidence[] }) {
  if (items.length === 0) return null;
  const groups = new Map<string, CmoSeoEvidence[]>();
  for (const item of items) {
    const key = `${SOURCE[item.source]}, ${day(item.observedAt)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <ul className="seo-evidence">
      {[...groups].map(([source, group]) => (
        <li key={source} className="note">
          {group.map(evidenceText).join(" · ")}{" "}
          <span className="muted">({source})</span>
        </li>
      ))}
    </ul>
  );
}

function DownloadButton({ text, title }: { text: string; title: string }) {
  const name = `${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)}.md`;
  return (
    <a
      className="button button-secondary button-small"
      download={name}
      href={`data:text/markdown;charset=utf-8,${encodeURIComponent(text)}`}
    >
      <Download size={14} aria-hidden="true" />
      Download
    </a>
  );
}

function AuditCard({ seo, timeZone }: { seo: CmoSeo; timeZone: string }) {
  const { audit } = seo;
  const latest = audit.latest;
  const schedule =
    audit.status === "active" ? (
      audit.running ? (
        "Running now. Results show here in a few minutes."
      ) : audit.nextRunAt ? (
        <>
          Next audit:{" "}
          <LocalDay at={audit.nextRunAt} serverZone={timeZone} time />.
        </>
      ) : (
        "Runs once a week."
      )
    ) : audit.status === "paused" ? (
      "Paused until your CMO plan is paid."
    ) : audit.status === "not_started" ? (
      `Starts once your plan is active and its credits cover ${audit.creditsPerAudit}.`
    ) : (
      "The weekly audit is not available here yet."
    );
  return (
    <section className="card">
      <h3>Weekly site audit</h3>
      <p className="muted">
        Once a week {AGENT_NAME}'s SEO specialist checks{" "}
        {pagePath(seo.websiteUrl)} on mobile and desktop. Each audit costs{" "}
        {audit.creditsPerAudit} credits from your plan. {schedule}
      </p>
      {audit.skipped[0] ? (
        <p className="alert" role="status">
          Skipped on {day(audit.skipped[0])}: your credits could not cover the{" "}
          {audit.creditsPerAudit} an audit costs. Top up and the next one runs.
        </p>
      ) : null}
      {audit.lastFailedAt ? (
        <p className="alert" role="status">
          The audit on {day(audit.lastFailedAt)} did not finish, so nothing was
          charged.{" "}
          {audit.retryAt ? (
            <>
              It runs again on{" "}
              <LocalDay at={audit.retryAt} serverZone={timeZone} time />.
            </>
          ) : audit.failedTries > 1 ? (
            `It failed ${audit.failedTries} times in a row, so the next try is the weekly audit.`
          ) : (
            "The next one runs on schedule."
          )}
        </p>
      ) : null}
      {latest ? (
        <>
          <div className="grid4">
            <div className="kpi">
              <span className="label">Checked</span>
              <span className="v num">{day(latest.observedAt)}</span>
            </div>
            <div className="kpi">
              <span className="label">Checks passed</span>
              <span className="v num">
                {latest.passed} of {latest.checked}
              </span>
            </div>
            <div className="kpi">
              <span className="label">To fix</span>
              <span className="v num">{latest.issues.length}</span>
            </div>
          </div>
          <AuditReadings latest={latest} />
          {latest.issues.length > 0 ? (
            <div className="stack-sm">
              <span className="label">Checks that did not pass</span>
              <ul className="list">
                {latest.issues.map((issue) => (
                  <li key={`${issue.title}-${issue.pageUrl}`} className="li">
                    <span className="tag">{issue.severity}</span>
                    <span className="grow">
                      <b>{withoutAuditIds(issue.title)}</b>
                      <br />
                      <span className="note">
                        {pagePath(issue.pageUrl)}
                        {issue.detail
                          ? ` · ${plainIssueDetail(issue.detail)}`
                          : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>Nothing to fix.</p>
          )}
        </>
      ) : (
        <p className="note">
          No audit yet. The first one lands here after it runs.
        </p>
      )}
    </section>
  );
}

/**
 * Why "passed" is not every check: some found something to fix, and the rest
 * only record a value (a title's length, a position). Those are listed, so
 * the numbers never contradict each other.
 */
function AuditReadings({
  latest,
}: {
  latest: NonNullable<CmoSeo["audit"]["latest"]>;
}) {
  // Core and CMO deploy apart: an older Core sends none of the three.
  const { failedChecks = 0, readingChecks = 0, readings = [] } = latest;
  if (failedChecks + readingChecks === 0) return null;
  const checks = (n: number) => `${n} ${n === 1 ? "check" : "checks"}`;
  return (
    <div className="stack-sm">
      <p className="note">
        {failedChecks > 0
          ? `${checks(failedChecks)} found what is listed to fix (one thing can show on your phone and desktop page). `
          : null}
        {readingChecks > 0
          ? `${checks(readingChecks)} only took a reading, such as how long your title is. A reading is not a problem.`
          : null}
      </p>
      {readings.length > 0 ? (
        <details>
          <summary>See the readings</summary>
          <ul className="list">
            {readings.map((reading) => (
              <li key={`${reading.title}-${reading.pageUrl}`} className="li">
                <span className="grow">
                  <b>{withoutAuditIds(reading.title)}</b>
                  <br />
                  <span className="note">
                    {pagePath(reading.pageUrl)}
                    {reading.detail
                      ? ` · ${plainIssueDetail(reading.detail)}`
                      : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function PageChange({
  change,
  setStatus,
}: {
  change: CmoSeoSuggestion;
  setStatus: (status: "open" | "done" | "dismissed") => Promise<void>;
}) {
  const copy = pageChangeCopy(change);
  const detail = copy.detail?.split("\n\n") ?? [];
  return (
    <li className="li seo-item">
      <div className="grow stack-sm">
        <b>{copy.title}</b>
        <span className="note">{pagePath(change.pageUrl)}</span>
        {change.newText && change.currentText ? (
          <BeforeAfter change={change} newText={change.newText} />
        ) : change.newText ? (
          <div className="seo-copy">
            <span className="label">New text</span>
            <p>{change.newText}</p>
            <div>
              <CopyButton text={change.newText} label="Copy" />
            </div>
          </div>
        ) : (
          <p>{copy.what}</p>
        )}
        <p className="note">{copy.why}</p>
        <details>
          <summary className="note">More detail</summary>
          {change.newText ? <p className="note">{copy.what}</p> : null}
          {detail.map((part) => (
            <p key={part} className="note">
              {part}
            </p>
          ))}
          <Evidence items={change.evidence} />
        </details>
      </div>
      <div className="seo-actions">
        {change.status === "verified" && change.verifiedAt ? (
          <StatusText>
            Confirmed by the audit on {day(change.verifiedAt)}
          </StatusText>
        ) : change.status === "done" && change.doneAt ? (
          <>
            <StatusText>Done {day(change.doneAt)}</StatusText>
            <span className="note">The next weekly audit checks it.</span>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => setStatus("open")}
            >
              Not done yet
            </button>
          </>
        ) : (
          <>
            <form action={() => setStatus("done")}>
              <SubmitButton className="button button-small">Done</SubmitButton>
            </form>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => setStatus("dismissed")}
            >
              Skip
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Article({
  article,
  write,
  setStatus,
}: {
  article: CmoSeoSuggestion;
  write: () => Promise<void>;
  setStatus: (status: "open" | "done" | "dismissed") => Promise<void>;
}) {
  return (
    <li className="li seo-item">
      <div className="grow stack-sm">
        <b>{article.title}</b>
        {article.keyword ? (
          <span className="note">For the search "{article.keyword}"</span>
        ) : null}
        <p className="note">{article.why}</p>
        <details>
          <summary className="note">
            {article.draft ? "Read the article" : "Outline and numbers"}
          </summary>
          <Evidence items={article.evidence} />
          <DraftText text={article.draft ?? article.body} />
        </details>
      </div>
      <div className="seo-actions">
        {article.draft ? (
          <>
            <CopyButton text={article.draft} label="Copy" />
            <DownloadButton text={article.draft} title={article.title} />
          </>
        ) : (
          <form action={write}>
            <SubmitButton className="button button-secondary button-small">
              Write it
            </SubmitButton>
          </form>
        )}
        {article.status === "done" ? (
          <StatusText>Published</StatusText>
        ) : (
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => setStatus(article.draft ? "done" : "dismissed")}
          >
            {article.draft ? "Mark published" : "Skip"}
          </button>
        )}
      </div>
    </li>
  );
}

/** Where a source stands, as its site's name. */
function sourceSite(url: string): string {
  return URL.parse(url)?.hostname.replace(/^www\./, "") ?? url;
}

/**
 * A page for a search that names a competitor: its words to copy, what it
 * says about the competitor with the competitor's own words, and where the
 * owner says it is live.
 */
function LandingPage({
  page,
  markLive,
  setStatus,
}: {
  page: CmoSeoSuggestion;
  markLive: (url: string) => Promise<void>;
  setStatus: (status: "open" | "done" | "dismissed") => Promise<void>;
}) {
  const live = page.status !== "open" && page.pageUrl;
  return (
    <li className="li seo-item">
      <div className="grow stack-sm">
        <b>{page.title}</b>
        {page.keyword ? (
          <span className="note">For the search "{page.keyword}"</span>
        ) : null}
        <p className="note">{page.why}</p>
        <Evidence items={page.evidence} />
        <details>
          <summary className="note">Read the page</summary>
          <DraftText text={page.draft ?? ""} />
        </details>
        {page.sources.length > 0 ? (
          <details>
            <summary className="note">
              What it says about them, and where they say it
            </summary>
            <ul className="list">
              {page.sources.map((source) => (
                <li key={`${source.sourceUrl}${source.quote}`} className="li">
                  <span className="grow stack-sm">
                    <span>{source.text}</span>
                    <span className="note">
                      "{source.quote}" (
                      <a
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {sourceSite(source.sourceUrl)}
                      </a>
                      )
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {live ? null : (
          <form
            className="seo-search"
            action={async (form) => {
              const url = String(form.get("url") ?? "").trim();
              if (url) await markLive(url);
            }}
          >
            <input
              aria-label={`Where "${page.title}" is live`}
              name="url"
              type="url"
              placeholder="https://your-site.com/the-page"
              maxLength={500}
              required
            />
            <SubmitButton className="button button-small">
              It's live
            </SubmitButton>
          </form>
        )}
      </div>
      <div className="seo-actions">
        {page.draft ? (
          <>
            <CopyButton text={page.draft} label="Copy" />
            <DownloadButton text={page.draft} title={page.title} />
          </>
        ) : null}
        {live ? (
          <>
            <StatusText>Live</StatusText>
            <span className="note">{pagePath(page.pageUrl)}</span>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => setStatus("open")}
            >
              Not live yet
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => setStatus("dismissed")}
          >
            Skip
          </button>
        )}
      </div>
    </li>
  );
}

/** The four numbers that say how the site does on Google, with their trend. */
function GoogleNumbers({ seo }: { seo: CmoSeo }) {
  const { totals, previousTotals: before } = seo.searchConsole;
  const latest = seo.audit.latest;
  if (!totals && !latest) return null;
  const kpi = (label: string, value: string, change: string | null) => (
    <div className="kpi" key={label}>
      <span className="label">{label}</span>
      <span className="v num">{value}</span>
      {change ? <span className="note">{change}</span> : null}
    </div>
  );
  return (
    <section className="card">
      <h3>{totals ? "Google, last 28 days" : "Your site"}</h3>
      <div className="grid4">
        {totals
          ? [
              kpi(
                "Clicks",
                count(totals.clicks),
                changeText(totals.clicks, before?.clicks),
              ),
              kpi(
                "Seen in search",
                count(totals.impressions),
                changeText(totals.impressions, before?.impressions),
              ),
              kpi(
                "Average position",
                totals.position?.toFixed(1) ?? NOT_KNOWN,
                positionChangeText(totals.position, before?.position),
              ),
            ]
          : null}
        {latest
          ? kpi(
              "Site checks",
              `${latest.passed} of ${latest.checked}`,
              `passed on ${day(latest.observedAt)}`,
            )
          : null}
      </div>
    </section>
  );
}

function ConnectStep({
  seo,
  connect,
}: {
  seo: CmoSeo;
  connect: SeoActions["connectSearchConsole"];
}) {
  const [error, setError] = useState<string | null>(null);
  const { status } = seo.searchConsole;
  return (
    <li className="li seo-item">
      <div className="grow stack-sm">
        <b>
          {status === "not_connected"
            ? "Connect Google Search Console"
            : "Reconnect Google Search Console"}
        </b>
        <p className="note">
          {status === "no_property"
            ? `The Google account you connected has no Search Console property for ${pagePath(seo.websiteUrl)}. Add the site in Search Console, or connect the account that has it.`
            : status === "unavailable"
              ? "Search Console did not answer just now. It is read again on your next visit."
              : `Then ${AGENT_NAME} sees which searches already find your site, and builds every change and article on them.`}
        </p>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="seo-actions">
        <form
          action={async () => {
            const { url, error } = await connect();
            if (url) window.location.assign(url);
            else setError(error);
          }}
        >
          <SubmitButton className="button button-small">
            {status === "not_connected" ? "Connect" : "Reconnect"}
          </SubmitButton>
        </form>
      </div>
    </li>
  );
}

export function SeoPage({
  actions,
  timeZone,
}: {
  actions: SeoActions;
  /** The clock Cuso works on, for when the next audit runs. */
  timeZone: string;
}) {
  const [seo, setSeo] = useState<CmoSeo | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await actions.loadSeo();
      setSeo(next);
      setFailed(next === null);
    } catch {
      setFailed(true);
    }
  }, [actions]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!seo)
    return (
      <>
        <PageLead kicker="SEO" title="Reading your audit." />
        <div className="page-body">
          {failed ? (
            <p className="alert" role="alert">
              The SEO tab could not load. It tries again in a moment.
            </p>
          ) : (
            <div className="empty">
              <Loader2 size={20} className="spin" aria-hidden="true" />
              <span>Loading</span>
            </div>
          )}
        </div>
      </>
    );

  const setStatus =
    (id: string) => async (status: "open" | "done" | "dismissed") => {
      const error = await actions.setSeoSuggestionStatus(id, status);
      setNote(error);
      await refresh();
    };
  const ask = async (articleId?: string, write = false) => {
    const error = await actions.askCusoForArticles(articleId, write);
    setNote(
      error ??
        (articleId || write
          ? `${AGENT_NAME} is writing it. It shows here when it is done, and he tells you in the chat.`
          : `${AGENT_NAME} is looking for new ideas. They show here in a few minutes, and he tells you in the chat.`),
    );
  };
  const markLive = (id: string) => async (url: string) => {
    const result = await actions.markLandingPageLive(id, url);
    setNote(result.error ?? result.note);
    await refresh();
  };
  const landingPages = seo.landingPages.filter((p) => p.status !== "dismissed");
  const steps = seoSteps(seo);
  const next = steps.slice(0, NEXT_SHOWN);
  const later = steps.slice(NEXT_SHOWN);
  const closed = seo.pageChanges.filter(
    (c) => c.status === "done" || c.status === "verified",
  );
  const shown = new Set(
    next.flatMap((step) => (step.kind === "connect" ? [] : [step.item.id])),
  );
  const articles = seo.articles.filter(
    (a) => a.status !== "dismissed" && !shown.has(a.id),
  );
  const latest = seo.audit.latest;
  const step = (item: SeoStep) =>
    item.kind === "connect" ? (
      <ConnectStep
        key="connect"
        seo={seo}
        connect={actions.connectSearchConsole}
      />
    ) : item.kind === "change" ? (
      <PageChange
        key={item.item.id}
        change={item.item}
        setStatus={setStatus(item.item.id)}
      />
    ) : (
      <Article
        key={item.item.id}
        article={item.item}
        write={() => ask(item.item.id)}
        setStatus={setStatus(item.item.id)}
      />
    );

  return (
    <>
      <PageLead {...seoLead(seo, timeZone)} />
      <div className="page-body">
        {note ? (
          <p className="alert" role="status">
            {note}
          </p>
        ) : null}
        <GoogleNumbers seo={seo} />
        <section className={next.length > 0 ? "card card-focus" : "card"}>
          <h3>
            {next.length > 1 ? `Next ${next.length} things to do` : "Next"}
          </h3>
          {next.length === 0 ? (
            <p className="note">
              Nothing to do right now. The weekly audit and {AGENT_NAME} add the
              next change here.
            </p>
          ) : (
            <ol className="list">{next.map(step)}</ol>
          )}
          {later.length > 0 ? (
            <details>
              <summary className="note">{later.length} more</summary>
              <ul className="list">{later.map(step)}</ul>
            </details>
          ) : null}
          {closed.length > 0 ? (
            <details>
              <summary className="note">Done ({closed.length})</summary>
              <ul className="list">
                {closed.map((change) => (
                  <PageChange
                    key={change.id}
                    change={change}
                    setStatus={setStatus(change.id)}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </section>
        <section className="card">
          <div className="seo-head">
            <h3>Articles</h3>
            <div className="seo-actions">
              <form action={() => ask()}>
                <SubmitButton className="button button-ghost button-small">
                  More ideas
                </SubmitButton>
              </form>
              <form action={() => ask(undefined, true)}>
                <SubmitButton className="button button-secondary button-small">
                  Write an article
                </SubmitButton>
              </form>
            </div>
          </div>
          <p className="muted">
            {AGENT_NAME} picks a search your buyers make and writes the whole
            article, ready to copy into your site. {ARTICLE_COST}
          </p>
          {articles.length === 0 &&
          !seo.articles.some((a) => shown.has(a.id)) ? (
            <p className="note">
              No article ideas yet. Ask for some and {AGENT_NAME} looks at what
              your buyers search for.
            </p>
          ) : null}
          {articles.length > 0 ? (
            <ul className="list">
              {articles.map((article) => (
                <Article
                  key={article.id}
                  article={article}
                  write={() => ask(article.id)}
                  setStatus={setStatus(article.id)}
                />
              ))}
            </ul>
          ) : null}
        </section>
        <div className="seo-folds">
          <details className="seo-fold">
            <summary>
              Weekly site audit
              {latest ? (
                <span className="note">
                  {latest.passed} of {latest.checked} checks passed
                </span>
              ) : null}
            </summary>
            <AuditCard seo={seo} timeZone={timeZone} />
          </details>
          {seo.searchConsole.status === "connected" ? (
            <details className="seo-fold">
              <summary>Your searches on Google</summary>
              <SearchConsoleCard
                seo={seo}
                connect={actions.connectSearchConsole}
              />
            </details>
          ) : null}
          <details className="seo-fold">
            <summary>Keyword search</summary>
            <KeywordSearch
              seo={seo}
              search={actions.searchKeywords}
              onSearched={refresh}
            />
          </details>
          {landingPages.length > 0 ? (
            <details className="seo-fold">
              <summary>
                Landing pages
                <span className="note">{landingPages.length}</span>
              </summary>
              <section className="card">
                <p className="muted">
                  Pages for people comparing you with a competitor, each with
                  the search in its heading and first paragraph. Publish one on
                  your site, then say where it is live: the search ad for that
                  search sends people there from then on.
                </p>
                <ul className="list">
                  {landingPages.map((page) => (
                    <LandingPage
                      key={page.id}
                      page={page}
                      markLive={markLive(page.id)}
                      setStatus={setStatus(page.id)}
                    />
                  ))}
                </ul>
              </section>
            </details>
          ) : null}
        </div>
      </div>
    </>
  );
}
