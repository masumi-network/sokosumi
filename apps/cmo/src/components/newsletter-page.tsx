"use client";

import type { CmoOverview, NewsletterIssueStatus } from "@sokosumi/core-client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { loadContacts } from "../app/cmo-actions";
import {
  changeNewsletterIssue,
  loadCalendarDrafts,
  loadNewsletter,
  prepareCalendarIssue,
  previewNewsletterIssue,
  subscribeNewsletterContacts,
} from "../app/newsletter-actions";
import { businessDisplayName } from "./business-mark";
import { FormField } from "./form-field";
import { NewsletterContacts } from "./newsletter-contacts";
import { SubmitButton } from "./submit-button";

const BUTTON = "button button-secondary button-small";
const STATUS = {
  DRAFT: "Draft",
  NEEDS_APPROVAL: "Needs approval",
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
  CANCELED: "Canceled",
} satisfies Record<NewsletterIssueStatus, string>;

type Newsletter = Awaited<ReturnType<typeof loadNewsletter>>;
type Preview = Awaited<ReturnType<typeof previewNewsletterIssue>>;
type ContactMatches = Awaited<ReturnType<typeof loadContacts>>["contacts"];

export interface NewsletterCalendarDraft {
  entryId: string;
  strategyId: string;
  title: string;
}

interface NewsletterPageProps {
  overview: CmoOverview;
  webOrigin: string;
  draft: () => void;
  calendarHandoff?: {
    piece: NewsletterCalendarDraft;
    close: () => void;
  };
}

export function NewsletterPage(props: NewsletterPageProps) {
  const [contactsOpened, setContactsOpened] = useState(false);

  return (
    <div className="page-body">
      <details
        className="card"
        onToggle={(event) => {
          if (event.currentTarget.open) setContactsOpened(true);
        }}
      >
        <summary>Contacts</summary>
        {contactsOpened ? (
          <NewsletterContacts projectId={props.overview.projectId} />
        ) : null}
      </details>
      <NewsletterSending {...props} />
    </div>
  );
}

function NewsletterSending({
  overview,
  webOrigin,
  draft,
  calendarHandoff,
}: NewsletterPageProps) {
  const { projectId } = overview;
  const [newsletter, setNewsletter] = useState<Newsletter | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Preview | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();
  const [message, setMessage] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);
  const [audience, setAudience] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ContactMatches | null>(null);
  const [searchError, setSearchError] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    setLoadError(false);
    try {
      setNewsletter(await loadNewsletter(projectId));
    } catch {
      setLoadError(true);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function searchContacts(formData: FormData) {
    const value = formData.get("query");
    if (typeof value !== "string" || !value.trim()) return;
    setAudience("");
    setMatches(null);
    setSearchError(false);
    try {
      const { contacts } = await loadContacts(projectId, {
        search: value.trim(),
      });
      setMatches(contacts);
    } catch {
      setSearchError(true);
    }
  }

  async function subscribe(formData: FormData) {
    setMessage("");
    setContactError(null);
    const consent = formData.get("consent");
    if (consent !== "ASK" && consent !== "CONFIRMED") {
      setContactError("Choose how to confirm consent.");
      return;
    }
    const [source, id] = audience.split(":");
    if (!id || (source !== "list" && source !== "contact")) {
      setContactError("Choose a contact or a list.");
      return;
    }
    try {
      const { error, result } = await subscribeNewsletterContacts(
        projectId,
        { source, id },
        consent,
      );
      if (error || !result) {
        setContactError(error ?? "Could not add subscribers.");
        return;
      }
      const {
        added,
        pendingConfirmation,
        alreadySubscribed,
        skippedNoEmail,
        skippedUnsubscribed,
        skippedBounced,
      } = result;
      setMessage(
        `${added - pendingConfirmation} added, ${pendingConfirmation} awaiting confirmation, ${alreadySubscribed} already on the newsletter. ${skippedNoEmail + skippedUnsubscribed + skippedBounced} skipped due to a missing email, an unsubscribe or a bounce.`,
      );
      setAudience("");
    } catch {
      setContactError(
        "Could not finish adding subscribers. Some contacts may have been added.",
      );
    } finally {
      await reload();
    }
  }

  function closeIssue() {
    setSelected(null);
    previewButton.current?.focus();
  }

  function openIssue(issueId: string, button?: HTMLButtonElement) {
    previewButton.current = button ?? null;
    setSelected(null);
    setIssueError(null);
    startOpening(async () => {
      try {
        setSelected(await previewNewsletterIssue(projectId, issueId));
      } catch {
        setIssueError("Could not preview the issue. Try again.");
      }
    });
  }

  const settingsUrl = new URL("/newsletter/settings", webOrigin);
  settingsUrl.searchParams.set("projectId", projectId);

  if (!newsletter) {
    return (
      <div className="page-body">
        {loadError ? (
          <section className="card">
            <p role="alert">Could not load Newsletter.</p>
            <div>
              <button type="button" className={BUTTON} onClick={reload}>
                Try again
              </button>
            </div>
          </section>
        ) : (
          <p role="status">Loading Newsletter…</p>
        )}
      </div>
    );
  }
  if (newsletter.state === "disabled") {
    return (
      <div className="page-body">
        <section className="card">
          <h3>Newsletter sending is in pilot</h3>
          <p>
            Sending opens when this workspace joins the pilot. Your newsletter
            copy is in Calendar.
          </p>
        </section>
      </div>
    );
  }
  if (newsletter.state === "setup") {
    return (
      <div className="page-body">
        <section className="card">
          <h3>Set up your newsletter</h3>
          <p>
            In Sokosumi, switch to the {businessDisplayName(overview)}{" "}
            workspace. Set your sender, reply address and design, then return
            here to add subscribers and schedule issues.
          </p>
          <div>
            <a
              href={settingsUrl.href}
              className={BUTTON}
              target="_blank"
              rel="noreferrer"
            >
              Open Newsletter settings in Sokosumi
            </a>
            <button type="button" className={BUTTON} onClick={reload}>
              Refresh setup
            </button>
          </div>
        </section>
      </div>
    );
  }

  const subscribersUrl = new URL("/newsletter/subscribers", settingsUrl);
  subscribersUrl.search = settingsUrl.search;
  const issuesUrl = new URL("/newsletter/issues", settingsUrl);
  issuesUrl.search = settingsUrl.search;
  const signupUrl = new URL(
    `/n/${encodeURIComponent(newsletter.publicSlug)}`,
    webOrigin,
  );

  return (
    <div className="page-body">
      {loadError ? (
        <p role="alert">
          Could not refresh the newsletter. Reload the page to see the latest
          status.
        </p>
      ) : null}
      <section className="card">
        <h3>{newsletter.name}</h3>
        <div className="crow">
          <a href={settingsUrl.href}>Sender and design settings in Sokosumi</a>
          <a href={signupUrl.href} target="_blank" rel="noreferrer">
            Open signup page
          </a>
        </div>
        <p className="note">
          For the Sokosumi links, select the {businessDisplayName(overview)}{" "}
          workspace there.
        </p>
      </section>

      {calendarHandoff ? (
        <CalendarIssueHandoff
          key={`${calendarHandoff.piece.strategyId}/${calendarHandoff.piece.entryId}`}
          projectId={projectId}
          piece={calendarHandoff.piece}
          close={calendarHandoff.close}
          prepared={async (issueId) => {
            calendarHandoff.close();
            openIssue(issueId);
            await reload();
          }}
        />
      ) : null}

      <section className="card">
        <div className="crow">
          <h3 className="grow">Subscribers</h3>
          <a href={subscribersUrl.href}>Manage subscribers in Sokosumi</a>
        </div>
        <p>
          {newsletter.counts.ACTIVE} active · {newsletter.counts.PENDING}{" "}
          awaiting confirmation
        </p>
        <p className="note">
          Add a contact or a list from this workspace. Contacts who unsubscribed
          or bounced stay off the mailing list.
        </p>
        <form className="fields" action={searchContacts}>
          <FormField
            id="newsletter-contact-search"
            name="query"
            label="Find a contact by name or email"
            type="search"
            maxLength={200}
            required
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div>
            <SubmitButton className={BUTTON}>Search contacts</SubmitButton>
          </div>
        </form>
        {searchError ? (
          <p role="alert">Could not search contacts. Try again.</p>
        ) : null}
        {matches?.length === 0 ? (
          <p role="status">No matching contacts.</p>
        ) : null}
        {newsletter.lists.length || matches?.length ? (
          <form className="fields" action={subscribe}>
            <div className="field">
              <label htmlFor="newsletter-audience">Who to add</label>
              <select
                id="newsletter-audience"
                required
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
              >
                <option value="">Choose a contact or list</option>
                {newsletter.lists.length ? (
                  <optgroup label="Contacts lists">
                    {newsletter.lists.map((list) => (
                      <option key={list.id} value={`list:${list.id}`}>
                        {list.name} ({list.count})
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {matches?.length ? (
                  <optgroup label="Matching contacts">
                    {matches.map(({ id, name, email }) => (
                      <option key={id} value={`contact:${id}`}>
                        {name} · {email ?? "No email"}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
            <fieldset key={audience}>
              <legend>Newsletter consent</legend>
              <div>
                <label>
                  <input
                    required
                    type="radio"
                    name="consent"
                    value="CONFIRMED"
                  />{" "}
                  Everyone selected has agreed to receive this newsletter.
                </label>
              </div>
              <div>
                <label>
                  <input required type="radio" name="consent" value="ASK" />{" "}
                  Send a confirmation email so people can opt in.
                </label>
              </div>
            </fieldset>
            {contactError ? <p role="alert">{contactError}</p> : null}
            <div>
              <SubmitButton className={BUTTON}>Add from Contacts</SubmitButton>
            </div>
          </form>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
      </section>

      <section className="card">
        <div className="crow">
          <h3 className="grow">Latest issues</h3>
          <a href={issuesUrl.href}>All issues in Sokosumi</a>
        </div>
        <div>
          <button type="button" className={BUTTON} onClick={draft}>
            Draft with your agent
          </button>
        </div>
        {newsletter.issues.length ? (
          <ul className="list">
            {newsletter.issues.map((issue) => (
              <li className="crow" key={issue.id}>
                <span className="grow">
                  <b>{issue.subject}</b>
                  <br />
                  <span className="note">
                    {issue.status === "NEEDS_APPROVAL" && issue.approvedAt
                      ? "Approved"
                      : STATUS[issue.status]}
                    {issue.scheduledAt
                      ? ` · ${new Date(issue.scheduledAt).toLocaleString()}`
                      : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={opening}
                  onClick={(event) => openIssue(issue.id, event.currentTarget)}
                >
                  Preview
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No issues yet.</p>
        )}
        {opening ? <p role="status">Loading preview…</p> : null}
        {issueError ? <p role="alert">{issueError}</p> : null}
      </section>

      {selected ? (
        <IssuePreview
          key={`${selected.id}:${selected.revision}`}
          issue={selected}
          projectId={projectId}
          settingsUrl={settingsUrl}
          close={closeIssue}
          updated={async () => {
            closeIssue();
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

interface CalendarIssueHandoffProps {
  projectId: string;
  piece: NewsletterCalendarDraft;
  close: () => void;
  prepared: (issueId: string) => Promise<void>;
}

function CalendarIssueHandoff({
  projectId,
  piece,
  close,
  prepared,
}: CalendarIssueHandoffProps) {
  const [drafts, setDrafts] = useState<Awaited<
    ReturnType<typeof loadCalendarDrafts>
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: NonNullable<typeof drafts>["next"]) => {
      setLoadError(false);
      setLoading(true);
      try {
        const page = await loadCalendarDrafts(projectId, cursor);
        setDrafts((current) => {
          const issues =
            cursor && current
              ? [...current.issues, ...page.issues]
              : page.issues;
          return {
            ...page,
            issues: Array.from(
              new Map(issues.map((issue) => [issue.id, issue])).values(),
            ),
          };
        });
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function prepare(formData: FormData) {
    const choice = formData.get("issueId");
    if (typeof choice !== "string" || !choice) return;
    setPrepareError(null);
    try {
      const result = await prepareCalendarIssue(
        projectId,
        piece.strategyId,
        piece.entryId,
        choice === "create" ? undefined : choice,
      );
      if (result.issueId) await prepared(result.issueId);
      else
        setPrepareError(
          result.error ?? "Could not prepare the newsletter issue.",
        );
    } catch {
      setPrepareError("Could not prepare the newsletter issue. Try again.");
    }
  }

  return (
    <section className="card">
      <h3>Prepare a calendar issue</h3>
      <p>{piece.title}</p>
      <p className="note">
        Use a draft already written for this piece or create one from the
        calendar copy. If an issue is already linked, it opens as saved.
      </p>
      <form className="fields" action={prepare}>
        <div className="field">
          <label htmlFor="calendar-newsletter-issue">Newsletter issue</label>
          <select id="calendar-newsletter-issue" name="issueId" required>
            <option value="">Choose an option</option>
            <option value="create">Create from calendar copy</option>
            {drafts?.issues.map((issue) => (
              <option key={issue.id} value={issue.id}>
                {issue.subject}
              </option>
            ))}
          </select>
        </div>
        {loading ? <p role="status">Loading existing drafts…</p> : null}
        {loadError ? <p role="alert">Could not load existing drafts.</p> : null}
        {loadError || drafts?.next.draft || drafts?.next.review ? (
          <div>
            <button
              type="button"
              className={BUTTON}
              disabled={loading}
              onClick={() => load(drafts?.next)}
            >
              {loadError ? "Retry loading drafts" : "Load more drafts"}
            </button>
          </div>
        ) : null}
        {prepareError ? <p role="alert">{prepareError}</p> : null}
        <div className="crow">
          <SubmitButton className={BUTTON}>Prepare issue</SubmitButton>
          <button type="button" className={BUTTON} onClick={close}>
            Close
          </button>
        </div>
      </form>
    </section>
  );
}

interface IssuePreviewProps {
  issue: Preview;
  projectId: string;
  settingsUrl: URL;
  close: () => void;
  updated: () => Promise<void>;
}

function IssuePreview({
  issue,
  projectId,
  settingsUrl,
  close,
  updated,
}: IssuePreviewProps) {
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  async function change(input: Parameters<typeof changeNewsletterIssue>[3]) {
    setError(null);
    try {
      const failure = await changeNewsletterIssue(
        projectId,
        issue.id,
        issue.revision,
        input,
      );
      if (failure) setError(failure);
      else await updated();
    } catch {
      setError("Could not update the issue. Try again.");
    }
  }

  async function schedule(formData: FormData) {
    const date = new Date(String(formData.get("scheduledAt") ?? ""));
    if (!Number.isFinite(date.getTime())) {
      setError("Choose a valid send date and time.");
      return;
    }
    await change({ action: "schedule", scheduledAt: date, timezone });
  }

  const editUrl = new URL(
    `/newsletter/issues/${encodeURIComponent(issue.id)}`,
    settingsUrl,
  );
  editUrl.search = settingsUrl.search;

  return (
    <section className="card">
      <div className="crow">
        <h3 className="grow" ref={heading} tabIndex={-1}>
          {issue.subject}
        </h3>
        <a href={editUrl.href}>Open issue in Sokosumi</a>
        <button className={BUTTON} type="button" onClick={close}>
          Close preview
        </button>
      </div>
      {issue.previewText ? (
        <p>Inbox preview text: {issue.previewText}</p>
      ) : null}
      {issue.html ? (
        <iframe
          className="newsletter-preview"
          title="Newsletter email preview"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={issue.html}
        />
      ) : (
        <p role="alert">
          Could not render the preview. Reopen this issue to try again.
        </p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {issue.html && issue.status === "DRAFT" ? (
        <form action={() => change({ action: "submit" })}>
          <SubmitButton className={BUTTON}>Request review</SubmitButton>
        </form>
      ) : null}
      {issue.html && issue.status === "NEEDS_APPROVAL" && !issue.approvedAt ? (
        <form action={() => change({ action: "approve" })}>
          <SubmitButton className={BUTTON}>Approve issue</SubmitButton>
        </form>
      ) : null}
      {issue.html && issue.status === "NEEDS_APPROVAL" && issue.approvedAt ? (
        <form className="fields" action={schedule}>
          <FormField
            id="newsletter-scheduled-at"
            name="scheduledAt"
            label="Send date and time"
            hint={timezone}
            type="datetime-local"
            required
          />
          <div>
            <SubmitButton className={BUTTON}>Schedule send</SubmitButton>
          </div>
        </form>
      ) : null}
      {issue.status === "SCHEDULED" ? (
        <form action={() => change({ action: "cancel" })}>
          <SubmitButton className={BUTTON}>Cancel scheduled send</SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
