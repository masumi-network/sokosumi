"use client";

import type { CmoKeywordSearch, CmoSeo } from "@sokosumi/core-client";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { AGENT_NAME } from "../../lib/agent";
import { SubmitButton } from "../submit-button";
import type { SeoActions } from "./seo-page";
import { count, day, NOT_KNOWN, pagePath } from "./seo-research-format";

export function SearchConsoleCard({
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
                {row.position === null
                  ? ""
                  : `position ${row.position.toFixed(1)} · `}
                seen {count(row.impressions)} · {count(row.clicks)} clicks
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
              {gsc.totals.position?.toFixed(1) ?? NOT_KNOWN}
            </span>
          </div>
          <div className="kpi">
            <span className="label">Clicked</span>
            <span className="v num">
              {gsc.totals.ctr === null
                ? NOT_KNOWN
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
                  <td>
                    {idea.keyword}
                    {idea.editorial || idea.measuredAt ? (
                      <>
                        <br />
                        <span className="note">
                          {idea.editorial ? "Editorial pick" : ""}
                          {idea.editorial && idea.measuredAt ? " · " : ""}
                          {idea.measuredAt
                            ? `Measured ${day(idea.measuredAt)}`
                            : ""}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td className="num">
                    {idea.searchVolume === null
                      ? NOT_KNOWN
                      : count(idea.searchVolume)}
                  </td>
                  <td className="num">{idea.difficulty ?? NOT_KNOWN}</td>
                  <td>{idea.intent ?? NOT_KNOWN}</td>
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

export function KeywordSearch({
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
