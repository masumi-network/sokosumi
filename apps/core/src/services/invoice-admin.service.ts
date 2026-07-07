import {
  buildOrganizationInvoiceCreditReferenceId,
  buildUserInvoiceCreditReferenceId,
} from "@sokosumi/database/helpers";
import {
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { hasStripeBillingAddressWithCountry } from "@sokosumi/utils";
import type Stripe from "stripe";

import { stripeClient } from "@/clients/stripe.client";
import { MAX_ADMIN_CREDIT_TTL_DAYS } from "@/lib/admin-credit-grant";
import prisma from "@/lib/db/prisma";
import { stripeCustomerBillingService } from "@/services/stripe-customer-billing.service";
import { handleInvoicePaidEvent } from "@/services/stripe-invoice-credit.service";

/**
 * Port of the web app's `invoiceAdminService`
 * (`apps/web/src/lib/services/invoice-admin.service.ts`): admin one-time
 * credit invoices issued through Stripe, granted through the shared
 * invoice-paid automation.
 */

const ADMIN_INVOICE_SOURCE = "admin_one_time_credit";

export type InvoiceTargetType = "user" | "organization";

export interface InvoiceTarget {
  targetType: InvoiceTargetType;
  targetId: string;
}

export interface InvoiceSummary {
  invoiceId: string;
  targetType: InvoiceTargetType;
  targetId: string;
  targetName: string;
  credits: number;
  ttlDays: number | null;
  currency: string;
  amountDue: number;
  status: Stripe.Invoice.Status | null;
  /** Stripe dashboard URL for the invoice (admin-facing, not the payment page). */
  dashboardUrl: string;
}

export interface CreditPriceOption {
  id: string;
  amountPerCredit: number;
  currency: string;
  nickname: string | null;
}

/** An admin invoice surfaced in the admin invoice list. */
export interface InvoiceListItem {
  invoiceId: string;
  targetType: InvoiceTargetType | null;
  targetName: string | null;
  credits: number;
  ttlDays: number | null;
  currency: string;
  amountDue: number;
  status: Stripe.Invoice.Status | null;
  /** Invoice creation time as a Unix timestamp in milliseconds. */
  createdAt: number;
  /** Stripe dashboard URL for the invoice (admin-facing, not the payment page). */
  dashboardUrl: string;
}

/** Statuses of invoices that still need attention (not paid, void, or
 * uncollectible). This is the default filter for the admin list. */
const UNFINISHED_INVOICE_STATUSES: Stripe.Invoice.Status[] = ["draft", "open"];

/** Max number of invoices returned by the admin list (per filter). */
const DEFAULT_INVOICE_LIST_LIMIT = 50;

/**
 * How many matching invoices to fetch per status before sorting newest-first.
 * Stripe's invoice search has no guaranteed ordering, so we must gather all
 * matches (not just the first `limit`) and sort ourselves to reliably surface
 * the most recent ones. This ceiling bounds API usage; it comfortably exceeds
 * realistic admin invoice volumes, where pagination usually stops on the
 * first page anyway.
 */
const INVOICE_SEARCH_FETCH_CEILING = 300;

/**
 * Status filter accepted by {@link invoiceAdminService.listInvoices}:
 * `"unfinished"` (draft + open, the default), `"all"` (every status), or a
 * specific Stripe invoice status.
 */
export type InvoiceStatusFilter = "unfinished" | "all" | Stripe.Invoice.Status;

export interface ListInvoicesParams {
  status?: InvoiceStatusFilter;
  /** When set, only invoices for this user/organization are returned. */
  recipient?: InvoiceTarget | null;
  limit?: number;
}

/** Identity of a grant target (user or organization) used for summaries and
 * credit-bucket verification, independent of Stripe billing details. */
interface TargetIdentity {
  targetType: InvoiceTargetType;
  id: string;
  name: string;
}

interface ResolvedTarget extends TargetIdentity {
  stripeCustomerId: string;
}

/**
 * Builds the account-scoped Stripe dashboard URL for an invoice (the
 * admin-facing view), not the customer hosted-invoice/payment page. Scoping by
 * account id makes the link resolve to the correct sandbox (or live) account
 * — `livemode` alone can't distinguish a sandbox from legacy test mode.
 */
function buildInvoiceDashboardUrl(
  invoice: Stripe.Invoice,
  accountId: string,
): string {
  return `https://dashboard.stripe.com/${accountId}/invoices/${invoice.id}`;
}

export class InvoiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceValidationError";
  }
}

function isPositiveIntegerCredits(credits: number): boolean {
  return Number.isFinite(credits) && Number.isInteger(credits) && credits > 0;
}

function toInvoiceSummary(
  invoice: Stripe.Invoice,
  target: TargetIdentity,
  credits: number,
  ttlDays: number | null,
  accountId: string,
): InvoiceSummary {
  if (!invoice.id) {
    throw new Error("Stripe invoice is missing an id");
  }

  return {
    invoiceId: invoice.id,
    targetType: target.targetType,
    targetId: target.id,
    targetName: target.name,
    credits,
    ttlDays,
    currency: invoice.currency ?? "",
    amountDue: invoice.amount_due ?? 0,
    status: invoice.status ?? null,
    dashboardUrl: buildInvoiceDashboardUrl(invoice, accountId),
  };
}

/** Reads a non-negative integer-ish value out of invoice metadata, returning
 * the fallback when it is missing or not a finite number. */
function parseMetadataNumber(
  value: string | undefined,
  fallback: number | null,
): number | null {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Resolves the grant target (type + display name) from an expanded invoice
 * customer. Returns nulls when the customer is unexpanded or deleted. */
function resolveTargetFromCustomer(customer: Stripe.Invoice["customer"]): {
  targetType: InvoiceTargetType | null;
  targetName: string | null;
} {
  if (!customer || typeof customer === "string" || customer.deleted) {
    return { targetType: null, targetName: null };
  }
  const customerType = customer.metadata?.customerType;
  const targetType: InvoiceTargetType | null =
    customerType === "user" || customerType === "organization"
      ? customerType
      : null;
  return { targetType, targetName: customer.name ?? null };
}

/**
 * Builds a single Stripe invoice search query that always scopes to admin
 * admin invoices (via the `grant_source` metadata), optionally narrowed
 * by a single status and/or customer. All values here are fixed enums, a known
 * constant, or a Stripe customer id, so they need no escaping.
 *
 * Stripe's search query language rejects a mix of `AND` and `OR` in one query,
 * so this builder only ever joins clauses with `AND` (single status). Filtering
 * by multiple statuses is done by running one query per status and merging the
 * results — see {@link invoiceAdminService.listInvoices}.
 */
function buildAdminInvoiceSearchQuery(params: {
  status?: Stripe.Invoice.Status;
  customerId?: string;
}): string {
  const clauses = [`metadata["grant_source"]:"${ADMIN_INVOICE_SOURCE}"`];

  if (params.customerId) {
    clauses.push(`customer:"${params.customerId}"`);
  }

  if (params.status) {
    clauses.push(`status:"${params.status}"`);
  }

  return clauses.join(" AND ");
}

function toInvoiceListItem(
  invoice: Stripe.Invoice,
  accountId: string,
): InvoiceListItem | null {
  if (!invoice.id) {
    return null;
  }
  const { targetType, targetName } = resolveTargetFromCustomer(
    invoice.customer,
  );
  return {
    invoiceId: invoice.id,
    targetType,
    targetName,
    credits: parseMetadataNumber(invoice.metadata?.credits, 0) ?? 0,
    ttlDays: parseMetadataNumber(invoice.metadata?.ttl_days, null),
    currency: invoice.currency ?? "",
    amountDue: invoice.amount_due ?? 0,
    status: invoice.status ?? null,
    createdAt: invoice.created * 1000,
    dashboardUrl: buildInvoiceDashboardUrl(invoice, accountId),
  };
}

function matchesListStatusFilter(
  itemStatus: Stripe.Invoice.Status | null,
  filter: InvoiceStatusFilter,
): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "unfinished") {
    return itemStatus === "draft" || itemStatus === "open";
  }
  return itemStatus === filter;
}

export const invoiceAdminService = (() => {
  async function ensureOrganizationStripeCustomerId(
    organizationId: string,
  ): Promise<ResolvedTarget> {
    const organization =
      await organizationRepository.getOrganizationWithRelationsById(
        organizationId,
        prisma,
      );

    if (!organization) {
      throw new InvoiceValidationError("Organization not found");
    }

    if (organization.stripeCustomerId) {
      return {
        targetType: "organization",
        id: organization.id,
        name: organization.name,
        stripeCustomerId: organization.stripeCustomerId,
      };
    }

    const customer = await stripeClient.createOrganizationCustomer({
      organizationId: organization.id,
      slug: organization.slug,
      name: organization.name,
    });

    await prisma.organization.update({
      where: { id: organization.id },
      data: { stripeCustomerId: customer.id },
    });

    return {
      targetType: "organization",
      id: organization.id,
      name: organization.name,
      stripeCustomerId: customer.id,
    };
  }

  async function ensureUserStripeCustomerId(
    userId: string,
  ): Promise<ResolvedTarget> {
    const user = await userRepository.getUserById(userId, prisma);

    if (!user) {
      throw new InvoiceValidationError("User not found");
    }

    if (user.stripeCustomerId) {
      return {
        targetType: "user",
        id: user.id,
        name: user.name,
        stripeCustomerId: user.stripeCustomerId,
      };
    }

    const customer = await stripeClient.createUserCustomer({
      userId: user.id,
      name: user.name,
      email: user.email,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
    });

    return {
      targetType: "user",
      id: user.id,
      name: user.name,
      stripeCustomerId: customer.id,
    };
  }

  async function resolveTarget(target: InvoiceTarget): Promise<ResolvedTarget> {
    return target.targetType === "user"
      ? ensureUserStripeCustomerId(target.targetId)
      : ensureOrganizationStripeCustomerId(target.targetId);
  }

  /** Resolves a recipient to its existing Stripe customer id without creating
   * one. Returns null when the recipient has no Stripe customer yet (so no
   * invoices can exist for them). */
  async function resolveExistingStripeCustomerId(
    recipient: InvoiceTarget,
  ): Promise<string | null> {
    if (recipient.targetType === "user") {
      const user = await userRepository.getUserById(recipient.targetId, prisma);
      return user?.stripeCustomerId ?? null;
    }
    const organization =
      await organizationRepository.getOrganizationWithRelationsById(
        recipient.targetId,
        prisma,
      );
    return organization?.stripeCustomerId ?? null;
  }

  /** Resolves the grant target (id + name + type) from an invoice by looking
   * up its Stripe customer. Mirrors the webhook's user-first resolution. */
  async function resolveInvoiceTarget(
    invoice: Stripe.Invoice,
  ): Promise<TargetIdentity> {
    const stripeCustomerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : (invoice.customer?.id ?? null);
    if (!stripeCustomerId) {
      throw new InvoiceValidationError("Invoice has no customer");
    }

    // Resolve the target user-first to mirror the webhook
    // (`handleInvoicePaidEvent` resolves a user customer before falling back
    // to an organization). An org-first lookup would never resolve a user
    // customer.
    const user = await userRepository.getUserByStripeCustomerId(
      stripeCustomerId,
      prisma,
    );
    if (user) {
      return { targetType: "user", id: user.id, name: user.name };
    }

    const organization =
      await organizationRepository.getOrganizationByStripeCustomerId(
        stripeCustomerId,
        prisma,
      );
    if (!organization) {
      throw new InvoiceValidationError(
        "Invoice does not belong to a user or organization",
      );
    }
    return {
      targetType: "organization",
      id: organization.id,
      name: organization.name,
    };
  }

  async function resolvePrice(priceId: string | null) {
    if (!priceId) {
      return await stripeClient.getBaseCreditTopUpPrice();
    }
    try {
      return await stripeClient.getCreditTopUpPriceById(priceId);
    } catch {
      throw new InvoiceValidationError("Selected price is not valid");
    }
  }

  /**
   * Grants the credits for an already-paid invoice via the shared invoice-paid
   * automation and verifies the grant landed. Idempotent against the
   * `invoice.paid` webhook Stripe also fires (shared reference-id dedup).
   */
  async function grantCreditsForPaidInvoice(
    paidInvoice: Stripe.Invoice,
    target: TargetIdentity,
  ): Promise<void> {
    if (!paidInvoice.id) {
      throw new Error("Stripe invoice is missing an id");
    }

    await handleInvoicePaidEvent(paidInvoice);

    const expectedReferenceId =
      target.targetType === "user"
        ? buildUserInvoiceCreditReferenceId(target.id, paidInvoice.id, "topup")
        : buildOrganizationInvoiceCreditReferenceId(
            target.id,
            paidInvoice.id,
            "topup",
          );
    const grantedBucketWhere =
      target.targetType === "user"
        ? {
            userId: target.id,
            organizationId: null,
            referenceId: expectedReferenceId,
          }
        : { organizationId: target.id, referenceId: expectedReferenceId };

    // handleInvoicePaidEvent can return early without granting (e.g. the
    // organization has no owner/members), leaving the invoice paid but no
    // credits issued. Verify the grant landed instead of reporting false
    // success; granting is idempotent, so a retry after fixing the cause
    // completes it.
    const grantedBucket = await prisma.creditBucket.findFirst({
      where: grantedBucketWhere,
      select: { id: true },
    });
    if (!grantedBucket) {
      throw new InvoiceValidationError(
        "Invoice was paid but credits were not granted (the organization may have no owner). Resolve the issue and mark it paid again to retry.",
      );
    }
  }

  return {
    async listPrices(): Promise<CreditPriceOption[]> {
      const prices = await stripeClient.listCreditTopUpPrices();
      return prices.map((price) => ({
        id: price.id,
        amountPerCredit: price.amountPerCredit,
        currency: price.currency,
        nickname: price.nickname,
      }));
    },

    /**
     * Lists admin invoices, most recent first. Defaults to
     * unfinished (draft + open) invoices but accepts a status filter
     * (`"all"` or a specific status) and an optional recipient filter. Only
     * invoices tagged with the admin grant source are returned, so normal
     * checkout/subscription invoices are filtered out.
     */
    async listInvoices(
      params: ListInvoicesParams = {},
    ): Promise<InvoiceListItem[]> {
      const status = params.status ?? "unfinished";
      const limit = params.limit ?? DEFAULT_INVOICE_LIST_LIMIT;

      let customerId: string | undefined;
      if (params.recipient) {
        const resolved = await resolveExistingStripeCustomerId(
          params.recipient,
        );
        // No Stripe customer means no invoices exist for the recipient yet.
        if (!resolved) {
          return [];
        }
        customerId = resolved;
      }

      // Stripe search can't mix AND and OR, so a multi-status filter runs one
      // AND-only query per status; "all" runs a single status-less query.
      const statusesToQuery: Array<Stripe.Invoice.Status | undefined> =
        status === "all"
          ? [undefined]
          : status === "unfinished"
            ? UNFINISHED_INVOICE_STATUSES
            : [status];

      const [searchResults, accountId] = await Promise.all([
        Promise.all(
          statusesToQuery.map((statusFilter) =>
            stripeClient.searchInvoices({
              query: buildAdminInvoiceSearchQuery({
                status: statusFilter,
                customerId,
              }),
              // Fetch all matches (not just `limit`) so the newest can be
              // selected after sorting — Stripe search isn't newest-first.
              maxResults: INVOICE_SEARCH_FETCH_CEILING,
            }),
          ),
        ),
        stripeClient.getAccountId(),
      ]);

      const seenInvoiceIds = new Set<string>();

      return (
        searchResults
          .flat()
          // Defensive: the search query already scopes to grant invoices, but
          // keep the check so a query change can never leak unrelated invoices.
          .filter(
            (invoice) =>
              invoice.metadata?.grant_source === ADMIN_INVOICE_SOURCE,
          )
          .map((invoice) => toInvoiceListItem(invoice, accountId))
          .filter((item): item is InvoiceListItem => item !== null)
          // Stripe search is eventually consistent — an invoice voided moments
          // ago can still match an earlier status:"open" query. Re-check the
          // live status on each result so filters stay accurate.
          .filter((item) => matchesListStatusFilter(item.status, status))
          // De-dupe across per-status queries (statuses are disjoint, so this
          // is belt-and-suspenders) before sorting newest-first.
          .filter((item) => {
            if (seenInvoiceIds.has(item.invoiceId)) {
              return false;
            }
            seenInvoiceIds.add(item.invoiceId);
            return true;
          })
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, limit)
      );
    },

    async createInvoice(params: {
      target: InvoiceTarget;
      credits: number;
      ttlDays: number | null;
      priceId: string | null;
    }): Promise<InvoiceSummary> {
      if (!isPositiveIntegerCredits(params.credits)) {
        throw new InvoiceValidationError("Credits must be a positive integer");
      }

      if (params.ttlDays !== null) {
        if (
          !Number.isInteger(params.ttlDays) ||
          params.ttlDays <= 0 ||
          params.ttlDays > MAX_ADMIN_CREDIT_TTL_DAYS
        ) {
          throw new InvoiceValidationError(
            `Expiry must be a positive integer of at most ${MAX_ADMIN_CREDIT_TTL_DAYS} days`,
          );
        }
      }

      // Target lookup, price lookup, Stripe account id, and billing details are
      // independent reads — run them concurrently rather than serially.
      const [target, price, accountId, billingDetails] = await Promise.all([
        resolveTarget(params.target),
        resolvePrice(params.priceId),
        stripeClient.getAccountId(),
        params.target.targetType === "user"
          ? stripeCustomerBillingService.getUserBillingDetails(
              params.target.targetId,
            )
          : stripeCustomerBillingService.getOrganizationBillingDetailsById(
              params.target.targetId,
            ),
      ]);

      if (!hasStripeBillingAddressWithCountry(billingDetails.address)) {
        throw new InvoiceValidationError(
          "Recipient billing address with country is required for invoicing",
        );
      }

      const invoice = await stripeClient.createAdminInvoice({
        customerId: target.stripeCustomerId,
        credits: params.credits,
        priceId: price.id,
        currency: price.currency,
        ttlDays: params.ttlDays ?? undefined,
      });

      // A non-free grant must cost something. Billing `quantity × price` lets
      // Stripe round a tiny fractional total down to $0, which would finalize
      // as paid and silently grant credits for free. Reject it so the admin
      // raises the credit amount or picks a higher price — this preserves the
      // old `getCreditTopUpTotalMinorUnits` >= 1 invariant.
      if ((invoice.amount_due ?? 0) === 0) {
        throw new InvoiceValidationError(
          "Grant total rounded to $0. Increase the credit amount or choose a higher price.",
        );
      }

      // A free ($0) grant finalizes as paid immediately, so grant the credits
      // now instead of waiting on the invoice.paid webhook. Non-free grants
      // stay open until an admin marks them paid (no "Mark as paid" step is
      // shown for an already-paid free grant).
      if (invoice.status === "paid") {
        await grantCreditsForPaidInvoice(invoice, target);
      }

      return toInvoiceSummary(
        invoice,
        target,
        params.credits,
        params.ttlDays,
        accountId,
      );
    },

    /**
     * Fetches a single admin invoice as a detail summary. Returns
     * null when the invoice does not exist or is not an admin invoice, so
     * the caller can surface a 404.
     */
    async getInvoice(invoiceId: string): Promise<InvoiceSummary | null> {
      let invoice: Stripe.Invoice;
      try {
        invoice = await stripeClient.getInvoice(invoiceId);
      } catch {
        return null;
      }

      if (invoice.metadata?.grant_source !== ADMIN_INVOICE_SOURCE) {
        return null;
      }

      const [target, accountId] = await Promise.all([
        resolveInvoiceTarget(invoice),
        stripeClient.getAccountId(),
      ]);

      return toInvoiceSummary(
        invoice,
        target,
        parseMetadataNumber(invoice.metadata?.credits, 0) ?? 0,
        parseMetadataNumber(invoice.metadata?.ttl_days, null),
        accountId,
      );
    },

    /**
     * Marks an admin invoice as paid and grants the credits instantly by
     * running the same invoice-paid automation the webhook uses. Granting is
     * idempotent: the shared reference-id dedup prevents a double grant when the
     * `invoice.paid` webhook later arrives (or is retried). Returns null when
     * the invoice does not exist, so the caller can surface a 404.
     */
    /**
     * Deletes or voids an admin invoice in Stripe. Draft invoices are
     * permanently deleted; open invoices are voided. Returns null when the
     * invoice does not exist, so the caller can surface a 404.
     */
    async deleteInvoice(invoiceId: string): Promise<void | null> {
      let existing: Stripe.Invoice;
      try {
        existing = await stripeClient.getInvoice(invoiceId);
      } catch {
        return null;
      }

      if (existing.metadata?.grant_source !== ADMIN_INVOICE_SOURCE) {
        throw new InvoiceValidationError("Invoice is not an admin invoice");
      }

      if (existing.status === "draft") {
        await stripeClient.deleteDraftInvoice(invoiceId);
        return;
      }

      if (existing.status === "open") {
        await stripeClient.voidInvoice(invoiceId);
        return;
      }

      throw new InvoiceValidationError(
        "Only draft or open invoices can be deleted",
      );
    },

    async markInvoicePaid(invoiceId: string): Promise<InvoiceSummary | null> {
      let existing: Stripe.Invoice;
      try {
        existing = await stripeClient.getInvoice(invoiceId);
      } catch {
        return null;
      }

      if (existing.metadata?.grant_source !== ADMIN_INVOICE_SOURCE) {
        throw new InvoiceValidationError("Invoice is not an admin invoice");
      }

      // Target resolution and the account-id lookup are independent reads —
      // run them concurrently.
      const [target, accountId] = await Promise.all([
        resolveInvoiceTarget(existing),
        stripeClient.getAccountId(),
      ]);

      // A non-zero invoice still open is marked paid out of band; a $0 invoice
      // is already "paid" on finalization, so we skip the pay call there.
      const paidInvoice =
        existing.status === "paid"
          ? existing
          : await stripeClient.payInvoiceOutOfBand(invoiceId);

      await grantCreditsForPaidInvoice(paidInvoice, target);

      return toInvoiceSummary(
        paidInvoice,
        target,
        parseMetadataNumber(paidInvoice.metadata?.credits, 0) ?? 0,
        parseMetadataNumber(paidInvoice.metadata?.ttl_days, null),
        accountId,
      );
    },
  };
})();
