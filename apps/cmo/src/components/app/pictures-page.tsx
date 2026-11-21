"use client";

import type {
  CmoPictureAlternative,
  CmoPictureGroup,
} from "@sokosumi/core-client";
import { useCallback, useMemo, useState } from "react";
import { useLoaded } from "../../hooks/effects/use-loaded";
import { AGENT_NAME } from "../../lib/agent";
import { channelLabel } from "../../lib/calendar";
import { channelTone } from "../../lib/channels";
import { picturesLead } from "../../lib/page-lead";
import { PageLead } from "./page-lead";

export interface PictureFilters {
  network?: string;
  month?: string;
  chosen?: boolean;
}

export interface PictureActions {
  loadPictures: (filters: PictureFilters) => Promise<CmoPictureGroup[] | null>;
}

interface PicturesPageProps {
  projectId: string;
  actions: PictureActions;
  /** Opens a post on the Calendar. */
  openPost: (postId: string) => void;
}

/** A picture of Cuso's, read through CMO's own server: the originals stay private. */
export function picturePreviewUrl(projectId: string, jobId: string): string {
  return `/api/pictures?project=${encodeURIComponent(projectId)}&job=${encodeURIComponent(jobId)}`;
}

function postDay(at: string | null): string {
  return at
    ? new Date(at).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "Not scheduled";
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const VERDICT: Record<CmoPictureAlternative["verdict"], string> = {
  passed: "Passed, not used",
  rejected: "Turned down",
  failed: "Failed to make",
  waiting: "Being made",
};

/**
 * Every picture Cuso made for the month's posts (Settings, Pictures): per
 * post the one that went on it, marked and linked to the post, beside it the
 * alternatives that were not chosen with the check's verdict, and the tries
 * that failed. Filters by network, month and chosen.
 */
export function PicturesPage({
  projectId,
  actions,
  openPost,
}: PicturesPageProps) {
  const [filters, setFilters] = useState<PictureFilters>({});
  const { loadPictures } = actions;
  const load = useCallback(
    () => loadPictures(filters),
    [loadPictures, filters],
  );
  const { value: groups, failed, reload } = useLoaded(load);
  // Every network and month on the unfiltered list, so a filter never hides the others.
  const all = useLoaded(useCallback(() => loadPictures({}), [loadPictures]));
  const seen = useMemo(() => {
    const list = all.value ?? [];
    return {
      networks: [...new Set(list.map((group) => group.network))].sort(),
      months: [
        ...new Set(
          list.flatMap((group) =>
            group.scheduledAt ? [group.scheduledAt.slice(0, 7)] : [],
          ),
        ),
      ].sort(),
    };
  }, [all.value]);

  const lead = useMemo(() => picturesLead(groups ?? []), [groups]);

  if (failed)
    return (
      <>
        <PageLead
          kicker="Settings · Pictures"
          title="Your pictures did not load."
        />
        <div className="page-body">
          <section className="card">
            <p className="muted">Nothing is lost. Load the page again.</p>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={reload}
            >
              Try again
            </button>
          </section>
        </div>
      </>
    );

  return (
    <>
      <PageLead {...lead} />
      <div className="page-body pictures-page">
        <div
          className="pictures-filters"
          role="group"
          aria-label="Filter pictures"
        >
          <button
            type="button"
            className="chip"
            aria-pressed={!filters.network}
            onClick={() => setFilters({ ...filters, network: undefined })}
          >
            All networks
          </button>
          {seen.networks.map((network) => (
            <button
              key={network}
              type="button"
              className="chip"
              aria-pressed={filters.network === network}
              onClick={() => setFilters({ ...filters, network })}
            >
              {channelLabel(network)}
            </button>
          ))}
          <label className="pictures-month">
            <span className="sr-only">Month</span>
            <select
              id="pictures-month"
              className="input"
              value={filters.month ?? ""}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  month: event.target.value || undefined,
                })
              }
            >
              <option value="">Every month</option>
              {seen.months.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="chip"
            aria-pressed={filters.chosen === true}
            onClick={() =>
              setFilters({
                ...filters,
                chosen: filters.chosen ? undefined : true,
              })
            }
          >
            Only pictures on posts
          </button>
        </div>
        {groups === null ? (
          <section className="card" aria-busy="true">
            <p className="muted">Loading every picture {AGENT_NAME} made…</p>
          </section>
        ) : groups.length === 0 ? (
          <section className="card">
            <p className="muted">
              {filters.network || filters.month || filters.chosen
                ? "No pictures match these filters."
                : `${AGENT_NAME} has not made a picture for your posts yet. They show here once your month is being made.`}
            </p>
          </section>
        ) : (
          groups.map((group) => (
            <PictureGroup
              key={`${group.postId}:${group.slot}:${group.alternatives[0]?.jobId ?? ""}`}
              group={group}
              projectId={projectId}
              openPost={openPost}
            />
          ))
        )}
      </div>
    </>
  );
}

function PictureGroup({
  group,
  projectId,
  openPost,
}: {
  group: CmoPictureGroup;
  projectId: string;
  openPost: (postId: string) => void;
}) {
  const chosen = group.alternatives.find((alternative) => alternative.chosen);
  const others = group.alternatives.filter(
    (alternative) => !alternative.chosen,
  );
  const chosenUrl =
    group.postedUrl ??
    (chosen?.hasImage ? picturePreviewUrl(projectId, chosen.jobId) : null);
  return (
    <section className="card picture-group">
      <header className="picture-head">
        <span className={`tag net-${channelTone(group.network)}`}>
          {channelLabel(group.network)}
        </span>
        <span className="note num">{postDay(group.scheduledAt)}</span>
        {group.alternatives.length > 1 ? (
          <span className="note">{group.alternatives.length} made</span>
        ) : null}
        <button
          type="button"
          className="button button-secondary button-small picture-open"
          onClick={() => openPost(group.postId)}
        >
          Open post
        </button>
      </header>
      <h2 className="picture-title">
        {group.headline ?? group.title ?? "Untitled post"}
      </h2>
      <div className="picture-row">
        <figure className="picture-chosen">
          {chosenUrl ? (
            // Previews come from CMO's own server; next/image would proxy them again.
            <img
              src={chosenUrl}
              alt={`The picture on the post: ${group.headline ?? group.title ?? ""}`}
              loading="lazy"
            />
          ) : (
            <div className="picture-empty">Not chosen yet</div>
          )}
          <figcaption>
            <span className="tag ok">On the post</span>
            {chosen ? <span className="note">{chosen.model}</span> : null}
            {group.reason ? (
              <p className="picture-reason">{group.reason}</p>
            ) : null}
          </figcaption>
        </figure>
        {others.length > 0 ? (
          <ul
            className="picture-alternatives"
            aria-label="Alternatives not chosen"
          >
            {others.map((alternative) => (
              <li
                key={alternative.jobId}
                className={`picture-alt verdict-${alternative.verdict}`}
              >
                {alternative.hasImage ? (
                  <img
                    src={picturePreviewUrl(projectId, alternative.jobId)}
                    alt={`${VERDICT[alternative.verdict]}, ${alternative.model}`}
                    loading="lazy"
                  />
                ) : (
                  <div className="picture-empty">No picture</div>
                )}
                <span className="tag">{VERDICT[alternative.verdict]}</span>
                <span className="note">{alternative.model}</span>
                {alternative.why ? (
                  <p className="picture-why">{alternative.why}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
