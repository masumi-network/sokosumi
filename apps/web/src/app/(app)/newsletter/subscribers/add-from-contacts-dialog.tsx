"use client";

import {
  type NewsletterAddFromContactsResult,
  NewsletterConsent,
} from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { useDebounce } from "use-debounce";
import { ContactAvatar, Dot } from "@/app/contacts/components/contact-visuals";
import {
  refreshContacts,
  useContactLists,
  useContactRows,
} from "@/app/contacts/components/use-contacts-data";
import {
  LIST_COLOR_DOT,
  matchesContactSearch,
  primaryEmail,
} from "@/app/contacts/contacts-view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getEnvPublicConfig } from "@/config/env.public";
import { addNewsletterSubscribersFromContacts } from "@/lib/actions/newsletter/subscribers";
import { NewsletterConsentChoice } from "./newsletter-consent-choice";

interface AddFromContactsDialogProps {
  projectId: string;
  newsletterName: string;
  onClose: () => void;
  onCloseAutoFocus: () => void;
}

export function AddFromContactsDialog({
  projectId,
  newsletterName,
  onClose,
  onCloseAutoFocus,
}: AddFromContactsDialogProps) {
  const t = useTranslations("App.Projects.Newsletter.Subscribers");
  const format = useFormatter();
  const router = useRouter();
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(
    search.trim(),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );
  const rows = useContactRows({
    search: debouncedSearch || undefined,
    sort: "name",
    direction: "asc",
  });
  const lists = useContactLists();
  const contacts =
    rows.data?.pages
      .flatMap((page) => page.contacts)
      .filter((contact) => matchesContactSearch(contact, search)) ?? [];
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [listIds, setListIds] = useState<string[]>([]);
  const [consent, setConsent] = useState<NewsletterConsent>();
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [consentError, setConsentError] = useState("");
  const [result, setResult] = useState<NewsletterAddFromContactsResult | null>(
    null,
  );
  const hasConsent =
    !!consent && (consent !== NewsletterConsent.CONFIRMED || consentConfirmed);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      pending ||
      !hasConsent ||
      !consent ||
      contactIds.length + listIds.length === 0
    )
      return;
    setPending(true);
    setError("");
    setConsentError("");
    try {
      const response = await addNewsletterSubscribersFromContacts({
        projectId,
        values: { contactIds, listIds, consent, consentConfirmed },
      });
      if (!response.ok) {
        setConsentError(response.error.fieldErrors?.consent?.[0] ?? "");
        setError(
          response.error.fieldErrors?.contactIds?.[0] ??
            response.error.fieldErrors?.listIds?.[0] ??
            response.error.message,
        );
        return;
      }
      setResult(response.value);
      void refreshContacts(cache);
      router.refresh();
    } catch {
      setError(t("FromContacts.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="app-scrollbar max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus();
        }}
      >
        <form noValidate onSubmit={handleSubmit} className="grid min-w-0 gap-5">
          <DialogHeader>
            <DialogTitle>{t("fromContacts")}</DialogTitle>
            <DialogDescription>
              {result
                ? t("FromContacts.doneDescription")
                : t("FromContacts.description")}
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <dl className="grid grid-cols-2 gap-3">
              {(
                [
                  "added",
                  "alreadySubscribed",
                  "skippedUnsubscribed",
                  "skippedBounced",
                  "skippedNoEmail",
                  "pendingConfirmation",
                ] as const
              ).map((key) => (
                <div key={key} className="rounded-lg border p-3">
                  <dt className="text-muted-foreground text-sm">
                    {t(`FromContacts.result.${key}`)}
                  </dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {format.number(result[key])}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <>
              <fieldset disabled={pending} className="min-w-0">
                <Tabs defaultValue="people">
                  <TabsList className="w-full">
                    <TabsTrigger value="people" className="flex-1">
                      {t("FromContacts.people")}
                    </TabsTrigger>
                    <TabsTrigger value="lists" className="flex-1">
                      {t("FromContacts.lists")}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="people" className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="newsletter-contacts-search">
                        {t("FromContacts.search")}
                      </Label>
                      <Input
                        id="newsletter-contacts-search"
                        type="search"
                        value={search}
                        maxLength={200}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </div>
                    {rows.isPending ? (
                      <p
                        role="status"
                        className="text-muted-foreground text-sm"
                      >
                        {t("FromContacts.loading")}
                      </p>
                    ) : null}
                    {rows.isError ? (
                      <div className="space-y-2">
                        <p
                          role="alert"
                          className="text-semantic-destructive-label text-sm"
                        >
                          {t("FromContacts.loadPeopleError")}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          loading={rows.isFetching}
                          onClick={() => void rows.refetch()}
                        >
                          {t("FromContacts.retry")}
                        </Button>
                      </div>
                    ) : null}
                    <div
                      className="app-scrollbar max-h-64 space-y-2 overflow-y-auto overscroll-contain"
                      aria-busy={rows.isFetching}
                    >
                      {contacts.map((contact) => {
                        const email = primaryEmail(contact.channels);
                        return (
                          <div
                            key={contact.id}
                            className="flex items-start gap-3 rounded-lg border p-3"
                          >
                            <Checkbox
                              id={`newsletter-person-${contact.id}`}
                              disabled={!email || pending}
                              checked={contactIds.includes(contact.id)}
                              onCheckedChange={(checked) =>
                                setContactIds((ids) =>
                                  checked === true
                                    ? [...ids, contact.id]
                                    : ids.filter((id) => id !== contact.id),
                                )
                              }
                              className="mt-1"
                            />
                            <Label
                              htmlFor={`newsletter-person-${contact.id}`}
                              className="flex min-w-0 flex-1 items-start gap-3 font-normal"
                            >
                              <ContactAvatar
                                name={contact.name}
                                src={contact.avatarUrl}
                                email={email}
                                kind={contact.kind}
                                className="size-8"
                              />
                              <span className="min-w-0 space-y-1 break-words">
                                <span className="block font-medium">
                                  {contact.name}
                                </span>
                                {contact.organization ? (
                                  <span className="text-muted-foreground block text-sm">
                                    {contact.organization}
                                  </span>
                                ) : null}
                                <span className="text-muted-foreground block text-sm break-all">
                                  {email ?? t("FromContacts.noEmail")}
                                </span>
                              </span>
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                    {!rows.isPending &&
                    !rows.isError &&
                    contacts.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t("FromContacts.noPeople")}
                      </p>
                    ) : null}
                    {rows.hasNextPage ? (
                      <Button
                        type="button"
                        variant="outline"
                        loading={rows.isFetchingNextPage}
                        disabled={pending}
                        onClick={() => void rows.fetchNextPage()}
                      >
                        {t("FromContacts.loadMore")}
                      </Button>
                    ) : null}
                  </TabsContent>
                  <TabsContent value="lists" className="space-y-3">
                    {lists.isPending ? (
                      <p
                        role="status"
                        className="text-muted-foreground text-sm"
                      >
                        {t("FromContacts.loading")}
                      </p>
                    ) : null}
                    {lists.isError ? (
                      <div className="space-y-2">
                        <p
                          role="alert"
                          className="text-semantic-destructive-label text-sm"
                        >
                          {t("FromContacts.loadListsError")}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          loading={lists.isFetching}
                          onClick={() => void lists.refetch()}
                        >
                          {t("FromContacts.retry")}
                        </Button>
                      </div>
                    ) : null}
                    <div className="app-scrollbar max-h-64 space-y-2 overflow-y-auto overscroll-contain">
                      {lists.data?.map((list) => (
                        <div
                          key={list.id}
                          className="flex items-start gap-3 rounded-lg border p-3"
                        >
                          <Checkbox
                            id={`newsletter-list-${list.id}`}
                            disabled={pending}
                            checked={listIds.includes(list.id)}
                            onCheckedChange={(checked) =>
                              setListIds((ids) =>
                                checked === true
                                  ? [...ids, list.id]
                                  : ids.filter((id) => id !== list.id),
                              )
                            }
                            className="mt-1"
                          />
                          <Label
                            htmlFor={`newsletter-list-${list.id}`}
                            className="flex min-w-0 flex-1 flex-wrap items-center gap-2 leading-normal"
                          >
                            <Dot className={LIST_COLOR_DOT[list.color]} />
                            <span className="min-w-0 break-words">
                              {list.name}
                            </span>
                            <span className="text-muted-foreground text-sm font-normal tabular-nums">
                              {t("FromContacts.members", { count: list.count })}
                            </span>
                          </Label>
                        </div>
                      ))}
                    </div>
                    {lists.data?.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t("FromContacts.noLists")}
                      </p>
                    ) : null}
                  </TabsContent>
                </Tabs>
              </fieldset>
              <div className="space-y-4">
                <p
                  role="status"
                  className="text-muted-foreground text-sm tabular-nums"
                >
                  {t("FromContacts.peopleSelected", {
                    count: contactIds.length,
                  })}
                  {" · "}
                  {t("FromContacts.listsSelected", { count: listIds.length })}
                </p>
                <NewsletterConsentChoice
                  newsletterName={newsletterName}
                  value={consent}
                  confirmed={consentConfirmed}
                  onValueChange={setConsent}
                  onConfirmedChange={setConsentConfirmed}
                  error={consentError}
                  disabled={pending}
                />
              </div>
            </>
          )}
          <p role="status" className="text-muted-foreground text-sm">
            {pending
              ? t("FromContacts.adding")
              : result
                ? t("FromContacts.doneDescription")
                : null}
          </p>
          {error ? (
            <p role="alert" className="text-semantic-destructive-label text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            {result ? (
              <Button type="button" variant="primary" onClick={onClose}>
                {t("done")}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={onClose}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={pending}
                  disabled={
                    !hasConsent || contactIds.length + listIds.length === 0
                  }
                >
                  {t("FromContacts.add")}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
