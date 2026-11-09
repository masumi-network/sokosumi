"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addContact, loadContacts } from "../../app/cmo-actions";
import { FormField } from "../form-field";
import { SubmitButton } from "../submit-button";

type Contacts = Awaited<ReturnType<typeof loadContacts>>;

const BUTTON = "button button-secondary button-small";

export function ContactsPage({ projectId }: { projectId: string }) {
  const [page, setPage] = useState<Contacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const request = useRef(0);
  const activeSearch = useRef("");

  const refresh = useCallback(
    async (query: string, cursor?: string) => {
      const requestId = ++request.current;
      activeSearch.current = query;
      setLoading(true);
      setLoadError(false);
      try {
        const result = await loadContacts(projectId, {
          search: query || undefined,
          cursor,
        });
        if (request.current !== requestId) return;
        setPage((previous) =>
          cursor && previous
            ? {
                ...result,
                contacts: [...previous.contacts, ...result.contacts],
              }
            : result,
        );
        setAppliedSearch(query);
      } catch {
        if (request.current === requestId) setLoadError(true);
      } finally {
        if (request.current === requestId) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void refresh("");
    return () => {
      request.current++;
    };
  }, [refresh]);

  async function create(formData: FormData) {
    setNotice("");
    try {
      const error = await addContact(projectId, formData);
      setContactError(error);
      if (!error) {
        setNotice("Contact added.");
        setName("");
        setEmail("");
        await refresh(activeSearch.current);
      }
    } catch {
      setContactError("Could not add the contact. Try again.");
    }
  }

  return (
    <div className="page-body">
      <section className="panel">
        <h3>Add a contact</h3>
        <form className="fields" action={create}>
          <FormField
            id="contact-name"
            name="name"
            label="Name"
            maxLength={200}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <FormField
            id="contact-email"
            name="email"
            label="Email (optional)"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {contactError ? <p role="alert">{contactError}</p> : null}
          <div>
            <SubmitButton className={BUTTON}>Add contact</SubmitButton>
          </div>
        </form>
        <p className="note" role="status">
          {notice}
        </p>
      </section>

      <section className="panel">
        <h3>Workspace contacts</h3>
        <form className="fields" action={() => refresh(search.trim())}>
          <FormField
            id="contact-search"
            name="search"
            label="Search contacts"
            type="search"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div>
            <SubmitButton className={BUTTON}>Search</SubmitButton>
          </div>
        </form>

        <div aria-busy={loading}>
          {loadError ? (
            <p role="alert">Could not load contacts. Search again to retry.</p>
          ) : null}
          {page ? (
            <>
              <p className="note" role="status">
                {page.total === 0
                  ? appliedSearch
                    ? "No matching contacts."
                    : "No contacts yet."
                  : `${page.total} ${page.total === 1 ? "contact" : "contacts"}`}
              </p>
              <ul className="list">
                {page.contacts.map((contact) => (
                  <li className="crow" key={contact.id}>
                    <span className="grow">
                      <b>{contact.name}</b>
                      <br />
                      <span className="note">
                        {[contact.role, contact.organization, contact.email]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {contact.lists.length > 0 ? (
                        <>
                          <br />
                          <span className="note">
                            {contact.lists.join(", ")}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {page.nextCursor ? (
                <button
                  type="button"
                  className={BUTTON}
                  disabled={loading}
                  onClick={() =>
                    refresh(appliedSearch, page.nextCursor ?? undefined)
                  }
                >
                  Load more
                </button>
              ) : null}
            </>
          ) : loading ? (
            <p className="note" role="status">
              Loading contacts…
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
