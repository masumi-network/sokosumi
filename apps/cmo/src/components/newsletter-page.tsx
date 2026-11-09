"use client";

import type { CmoOverview, NewsletterIssueStatus } from "@sokosumi/core-client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  changeNewsletterIssue,
  loadNewsletter,
  previewNewsletterIssue,
  subscribeNewsletterContacts,
} from "../app/newsletter-actions";
import { businessDisplayName } from "./business-mark";
import { FormField } from "./form-field";
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

interface NewsletterPageProps {
  overview: CmoOverview;
  webOrigin: string;
  draft: () => void;
}

export function NewsletterPage({
  overview,
  webOrigin,
  draft,
}: NewsletterPageProps) {
  const { projectId } = overview;
  const [newsletter, setNewsletter] = useState<Newsletter | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<Preview | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();
  const [message, setMessage] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);
  const [listId, setListId] = useState("");
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

  async function subscribe(formData: FormData) {
    setMessage("");
    setContactError(null);
    const consent = formData.get("consent");
    if (consent !== "ASK" && consent !== "CONFIRMED") {
      setContactError("Choose how to confirm consent.");
      return;
    }
    try {
      const { error, result } = await subscribeNewsletterContacts(
        projectId,
        listId,
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

  function openIssue(issueId: string, button: HTMLButtonElement) {
    previewButton.current = button;
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
          <section className="panel">
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
        <section className="panel">
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
        <section className="panel">
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
      <section className="panel">
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

      <section className="panel">
        <div className="crow">
          <h3 className="grow">Subscribers</h3>
          <a href={subscribersUrl.href}>Manage subscribers in Sokosumi</a>
        </div>
        <p>
          {newsletter.counts.ACTIVE} active · {newsletter.counts.PENDING}{" "}
          awaiting confirmation
        </p>
        <p className="note">
          Add an existing Contacts list. Contacts who unsubscribed or bounced
          stay off the mailing list.
        </p>
        {newsletter.lists.length ? (
          <form className="fields" action={subscribe}>
            <div className="field">
              <label htmlFor="newsletter-contact-list">Contacts list</label>
              <select
                id="newsletter-contact-list"
                required
                value={listId}
                onChange={(event) => setListId(event.target.value)}
              >
                <option value="">Choose a list</option>
                {newsletter.lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list.count})
                  </option>
                ))}
              </select>
            </div>
            <fieldset>
              <legend>Newsletter consent</legend>
              <div>
                <label>
                  <input
                    required
                    type="radio"
                    name="consent"
                    value="CONFIRMED"
                  />{" "}
                  Everyone on this list has agreed to receive this newsletter.
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
        ) : (
          <p>
            No contact lists yet. Create a list in your workspace’s Contacts in
            Sokosumi.
          </p>
        )}
        {message ? <p role="status">{message}</p> : null}
      </section>

      <section className="panel">
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
    <section className="panel">
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
