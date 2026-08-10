"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEnvPublicConfig } from "@/config/env.public";
import { listAdminOrganizationsAction } from "@/lib/actions/admin-organizations/action";
import type {
  AdminOrganizationOverviewItem,
  AdminOrganizationOverviewPage,
} from "@/lib/services/admin-organization.service";

interface OrganizationListProps {
  initialPage: AdminOrganizationOverviewPage;
}

export function OrganizationList({ initialPage }: OrganizationListProps) {
  const t = useTranslations("App.Admin.Organizations.OrganizationList");
  const formatter = useFormatter();

  const [organizations, setOrganizations] = useState<
    AdminOrganizationOverviewItem[]
  >(initialPage.organizations);
  const [total, setTotal] = useState(initialPage.total);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [search, setSearch] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const latestRequestId = useRef(0);

  function fetchPage(query: string, cursor?: string) {
    const requestId = ++latestRequestId.current;
    if (!cursor) {
      setActiveQuery(query);
    }
    startTransition(async () => {
      const result = await listAdminOrganizationsAction({
        query: query.trim() || undefined,
        cursor,
      });
      if (requestId !== latestRequestId.current) {
        return;
      }
      if (!result.ok) {
        toast.error(result.error.message ?? t("loadError"));
        return;
      }
      setOrganizations((current) =>
        cursor
          ? [...current, ...result.value.organizations]
          : result.value.organizations,
      );
      setTotal(result.value.total);
      setNextCursor(result.value.nextCursor);
    });
  }

  const debouncedSearch = useDebouncedCallback(
    (value: string) => fetchPage(value),
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  function handleSearchChange(value: string) {
    setSearch(value);
    debouncedSearch(value);
  }

  function handleLoadMore() {
    if (!nextCursor) {
      return;
    }
    fetchPage(activeQuery, nextCursor);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-sm"
          aria-label={t("searchPlaceholder")}
        />
        <p className="text-muted-foreground text-sm tabular-nums">
          {t("totalCount", { count: total })}
        </p>
      </div>

      {organizations.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div
          className="overflow-hidden rounded-lg border"
          aria-busy={isPending}
        >
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">{t("organization")}</TableHead>
                <TableHead className="text-right">{t("members")}</TableHead>
                <TableHead>{t("billing")}</TableHead>
                <TableHead>{t("subscription")}</TableHead>
                <TableHead className="pr-4">{t("created")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((organization) => (
                <TableRow key={organization.id}>
                  <TableCell className="pl-4">
                    <Link
                      href={`/admin/organizations/${organization.slug}`}
                      className="flex flex-col hover:underline"
                    >
                      <span className="font-medium">{organization.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {organization.slug}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatter.number(organization.memberCount)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col">
                      <span>{organization.billingPlan}</span>
                      <span className="text-muted-foreground text-xs">
                        {t("seats", { count: organization.purchasedSeats })}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {organization.subscriptionPlan ? (
                      <span className="flex items-center gap-2">
                        <span>{organization.subscriptionPlan}</span>
                        {organization.subscriptionStatus ? (
                          <Badge
                            variant={
                              organization.subscriptionStatus === "active"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {organization.subscriptionStatus}
                          </Badge>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-4">
                    {formatter.dateTime(organization.createdAt, {
                      dateStyle: "medium",
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isPending}
          >
            {t("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
