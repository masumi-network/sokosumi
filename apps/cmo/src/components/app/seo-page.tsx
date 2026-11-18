"use client";

import type {
  CmoKeywordSearch,
  CmoSeo,
  CmoSeoEvidence,
  CmoSeoSuggestion,
} from "@sokosumi/core-client";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AGENT_NAME } from "../../lib/agent";
import { DraftText } from "../draft-text";
import { StatusText } from "../status";
import { SubmitButton } from "../submit-button";

export interface SeoActions {
  loadSeo: () => Promise<CmoSeo | null>;
  searchKeywords: (
    topic: string,
  ) => Promise<{ search: CmoKeywordSearch | null; error: string | null }>;
  setSeoSuggestionStatus: (
    id: string,
    status: "open" | "done" | "dismissed",
  ) => Promise<string | null>;
  /** No id: more article ideas; an id: the full article. */
  askCusoForArticles: (articleId?: string) => Promise<string | null>;
  connectSearchConsole: () => Promise<{
    url: string | null;
    error: string | null;
  }>;
}

/** While the tab is open it reads again this often, so Cuso's new ideas show up. */
const REFRESH_MS = 20_000;

const day = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const count = (value: number) => value.toLocaleString("en-US");

const weekday = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

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
      return e.value;
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

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button button-secondary button-small"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
      {copied ? "Copied" : label}
    </button>
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

function pagePath(url: string | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

function AuditCard({ seo }: { seo: CmoSeo }) {
  const { audit } = seo;
  const latest = audit.latest;
  const schedule =
    audit.status === "active"
      ? audit.running
        ? "Running now. Results show here in a few minutes."
        : audit.nextRunAt
          ? `Next audit: ${weekday(audit.nextRunAt)}.`
          : "Runs once a week."
      : audit.status === "paused"
        ? "Paused until your CMO plan is paid."
        : audit.status === "not_started"
          ? `Starts once your plan is active and its credits cover ${audit.creditsPerAudit}.`
          : "The weekly audit is not available here yet.";
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
          charged. The next one runs on schedule.
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
              <span className="label">Issues</span>
              <span className="v num">{latest.issues.length}</span>
            </div>
          </div>
          {latest.issues.length > 0 ? (
            <ul className="list">
              {latest.issues.map((issue) => (
                <li key={`${issue.title}-${issue.pageUrl}`} className="li">
                  <span className="tag">{issue.severity}</span>
                  <span className="grow">
                    <b>{issue.title}</b>
                    <br />
                    <span className="note">
                      {pagePath(issue.pageUrl)}
                      {issue.detail ? ` · ${issue.detail}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No issues found.</p>
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

function SearchConsoleCard({
  seo,
  connect,
}: {
  seo: CmoSeo;
  connect: SeoActions["connectSearchConsole"];
}) {
  const gsc = seo.searchConsole;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const start = async () => {
    setPending(true);
    const { url, error } = await connect();
    if (url) window.location.assign(url);
    else {
      setError(error);
      setPending(false);
    }
  };
  if (gsc.status !== "connected")
    return (
      <section className="card card-focus">
        <h3>Google Search Console</h3>
        <p className="muted">
          {gsc.status === "no_property"
            ? `The Google account you connected has no Search Console property for ${pagePath(seo.websiteUrl)}. Add the site in Search Console, or connect the account that has it.`
            : gsc.status === "unavailable"
              ? "Search Console did not answer just now. It is read again on your next visit."
              : `Connect it and ${AGENT_NAME} sees the searches that already find your site: clicks, how often you show up and where you rank. Everything here works without it, with less to go on.`}
        </p>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={pending}
            onClick={start}
          >
            {pending ? (
              <Loader2 size={14} className="spin" aria-hidden="true" />
            ) : null}
            {gsc.status === "not_connected" ? "Connect" : "Reconnect"}
          </button>
        </div>
      </section>
    );
  const rows = (
    title: string,
    items: CmoSeo["searchConsole"]["nearFirstPage"],
    empty: string,
  ) => (
    <div className="stack-sm">
      <span className="label">{title}</span>
      {items.length === 0 ? (
        <p className="note">{empty}</p>
      ) : (
        <ul className="list">
          {items.map((row) => (
            <li key={`${row.query}-${row.pageUrl}`} className="li">
              <span className="grow">
                <b>{row.query}</b>
                <br />
                <span className="note">{pagePath(row.pageUrl)}</span>
              </span>
              <span className="note num">
                position {row.position?.toFixed(1)} · seen{" "}
                {count(row.impressions)} · {count(row.clicks)} clicks
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <section className="card">
      <h3>Google Search Console</h3>
      <p className="muted">
        {gsc.from && gsc.to
          ? `${day(gsc.from)} to ${day(gsc.to)}, the last 28 days Google has settled.`
          : null}
      </p>
      {gsc.totals ? (
        <div className="grid4">
          <div className="kpi">
            <span className="label">Clicks</span>
            <span className="v num">{count(gsc.totals.clicks)}</span>
          </div>
          <div className="kpi">
            <span className="label">Seen in search</span>
            <span className="v num">{count(gsc.totals.impressions)}</span>
          </div>
          <div className="kpi">
            <span className="label">Average position</span>
            <span className="v num">
              {gsc.totals.position?.toFixed(1) ?? "None"}
            </span>
          </div>
          <div className="kpi">
            <span className="label">Clicked</span>
            <span className="v num">
              {gsc.totals.ctr === null
                ? "None"
                : `${(gsc.totals.ctr * 100).toFixed(1)}%`}
            </span>
          </div>
        </div>
      ) : null}
      {rows(
        "Close to page one",
        gsc.nearFirstPage,
        "No search ranks 8 to 20 yet.",
      )}
      {rows(
        "Seen near the top, rarely clicked",
        gsc.lowClickRate,
        "No top result is being skipped.",
      )}
    </section>
  );
}

function PageChange({
  change,
  setStatus,
}: {
  change: CmoSeoSuggestion;
  setStatus: (status: "open" | "done" | "dismissed") => Promise<void>;
}) {
  return (
    <li className="li seo-item">
      <div className="grow stack-sm">
        <b>{change.title}</b>
        <span className="note">{pagePath(change.pageUrl)}</span>
        <p>{change.body}</p>
        {change.newText ? (
          <div className="seo-copy">
            <span className="label">New text</span>
            <p>{change.newText}</p>
            <div>
              <CopyButton text={change.newText} label="Copy" />
            </div>
          </div>
        ) : null}
        <p className="note">{change.why}</p>
        <Evidence items={change.evidence} />
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
        <Evidence items={article.evidence} />
        <details>
          <summary className="note">
            {article.draft ? "Read the article" : "Outline"}
          </summary>
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

function KeywordResults({ search }: { search: CmoKeywordSearch }) {
  return (
    <div className="stack-sm">
      <p className="note">
        "{search.topic}": Google in {search.countryCode},{" "}
        {search.languageCode.toUpperCase()}, {day(search.observedAt)}
      </p>
      {search.ideas.length === 0 ? (
        <p className="note">No searches found for this topic.</p>
      ) : (
        <div className="seo-table-wrap">
          <table className="seo-table">
            <thead>
              <tr>
                <th scope="col">Search</th>
                <th scope="col">A month</th>
                <th scope="col">Difficulty</th>
                <th scope="col">Intent</th>
                <th scope="col">You rank</th>
              </tr>
            </thead>
            <tbody>
              {search.ideas.map((idea) => (
                <tr key={idea.keyword}>
                  <td>{idea.keyword}</td>
                  <td className="num">
                    {idea.searchVolume === null
                      ? "None"
                      : count(idea.searchVolume)}
                  </td>
                  <td className="num">{idea.difficulty ?? "None"}</td>
                  <td>{idea.intent ?? "None"}</td>
                  <td className="num">
                    {idea.position === null ? "Not yet" : idea.position}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KeywordSearch({
  seo,
  search,
  onSearched,
}: {
  seo: CmoSeo;
  search: SeoActions["searchKeywords"];
  onSearched: () => Promise<void>;
}) {
  const [shown, setShown] = useState<CmoKeywordSearch | null>(
    seo.keywordSearches[0] ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card">
      <h3>Keyword search</h3>
      <p className="muted">
        Type a topic and see what people search for: searches a month, how hard
        it is to rank, what they want, and where you rank today. You can also
        ask {AGENT_NAME} in the chat.
      </p>
      <form
        className="seo-search"
        action={async (form) => {
          const topic = String(form.get("topic") ?? "").trim();
          if (topic.length < 2) return;
          const result = await search(topic);
          setError(result.error);
          if (result.search) setShown(result.search);
          await onSearched();
        }}
      >
        <input
          aria-label="Topic"
          name="topic"
          placeholder="team scheduling software"
          minLength={2}
          maxLength={80}
          required
        />
        <SubmitButton className="button">Search</SubmitButton>
      </form>
      <p className="note">{seo.keywordSearchesLeft} searches left today.</p>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      {seo.keywordSearches.length > 1 ? (
        <div className="seo-recent">
          {seo.keywordSearches.map((recent) => (
            <button
              key={recent.topic}
              type="button"
              className="chip"
              aria-pressed={shown?.topic === recent.topic}
              onClick={() => setShown(recent)}
            >
              {recent.topic}
            </button>
          ))}
        </div>
      ) : null}
      {shown ? <KeywordResults search={shown} /> : null}
    </section>
  );
}

export function SeoPage({ actions }: { actions: SeoActions }) {
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
    );

  const setStatus =
    (id: string) => async (status: "open" | "done" | "dismissed") => {
      const error = await actions.setSeoSuggestionStatus(id, status);
      setNote(error);
      await refresh();
    };
  const ask = async (articleId?: string) => {
    const error = await actions.askCusoForArticles(articleId);
    setNote(
      error ??
        (articleId
          ? `${AGENT_NAME} is writing it. It shows here when it is done, and he tells you in the chat.`
          : `${AGENT_NAME} is looking for new ideas. They show here in a few minutes, and he tells you in the chat.`),
    );
  };
  const changes = seo.pageChanges.filter((c) => c.status !== "dismissed");
  const open = changes.filter((c) => c.status === "open");
  const articles = seo.articles.filter((a) => a.status !== "dismissed");

  return (
    <div className="page-body">
      {note ? (
        <p className="alert" role="status">
          {note}
        </p>
      ) : null}
      <AuditCard seo={seo} />
      <section className={open.length > 0 ? "card card-focus" : "card"}>
        <h3>Page changes</h3>
        <p className="muted">
          What to change on your site, with the exact new text to copy. Mark one
          done once it is live and the next weekly audit checks it.
        </p>
        {changes.length === 0 ? (
          <p className="note">
            Nothing to change yet. The weekly audit and Search Console add
            changes here.
          </p>
        ) : (
          <ul className="list">
            {changes.map((change) => (
              <PageChange
                key={change.id}
                change={change}
                setStatus={setStatus(change.id)}
              />
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <div className="seo-head">
          <h3>Articles to write</h3>
          <form action={() => ask()}>
            <SubmitButton className="button button-secondary button-small">
              More article ideas
            </SubmitButton>
          </form>
        </div>
        <p className="muted">
          Articles people search for, each built on real search numbers.{" "}
          {AGENT_NAME} writes the full text when you ask, ready to copy into
          your site.
        </p>
        {articles.length === 0 ? (
          <p className="note">
            No article ideas yet. Ask for some and {AGENT_NAME} researches what
            your buyers search for.
          </p>
        ) : (
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
        )}
      </section>
      <KeywordSearch
        seo={seo}
        search={actions.searchKeywords}
        onSearched={refresh}
      />
      <SearchConsoleCard seo={seo} connect={actions.connectSearchConsole} />
    </div>
  );
}
