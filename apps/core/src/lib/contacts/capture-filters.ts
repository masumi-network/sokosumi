/**
 * Who automatic capture must never turn into a contact: the owner, their
 * teammates, and machines. Deterministic and cheap; only role inboxes
 * ("sales@", "hello@") are left to the judge as borderline.
 */

/** Mail providers whose domain says nothing about the company. */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "gmx.de",
  "gmx.net",
  "gmx.ch",
  "web.de",
  "t-online.de",
  "bluewin.ch",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "hey.com",
  "fastmail.com",
  "zoho.com",
  "yandex.com",
]);

/**
 * Domains that only send machine mail: bulk senders, transactional
 * platforms, ticketing systems and mailing-list hosts. Subdomains match too
 * (`bounce.mailchimp.com`). Nobody is reached there even when the owner
 * writes to it. Extend it when a new platform slips through.
 */
export const SENDING_INFRASTRUCTURE_DOMAINS: ReadonlySet<string> = new Set([
  "amazonses.com",
  "sendgrid.net",
  "mailgun.org",
  "mailgun.net",
  "mcsv.net",
  "mcdlv.net",
  "list-manage.com",
  "mandrillapp.com",
  "sparkpostmail.com",
  "postmarkapp.com",
  "mailjet.com",
  "sendinblue.com",
  "hubspotemail.net",
  "hubspotstarter.net",
  "hs-mail.com",
  "mktomail.com",
  "exacttarget.com",
  "exct.net",
  "createsend.com",
  "cmail19.com",
  "cmail20.com",
  "customeriomail.com",
  "intercom-mail.com",
  "zendesk.com",
  "freshdesk.com",
  "helpscout.net",
  "facebookmail.com",
  "googlegroups.com",
  "groups.io",
  "docusign.net",
  "atlassian.net",
]);

/**
 * Platforms whose mail is notifications, receipts and digests. Their staff
 * are real people, so this only applies to mail the owner did not start:
 * inbound mail and meeting invitations, never an address the owner wrote to.
 */
export const NOTIFICATION_PLATFORM_DOMAINS: ReadonlySet<string> = new Set([
  "linkedin.com",
  "twitter.com",
  "x.com",
  "github.com",
  "gitlab.com",
  "notion.so",
  "slack.com",
  "substack.com",
  "medium.com",
  "stripe.com",
  "paypal.com",
  "shopify.com",
  "squarespace.com",
  "wix.com",
  "calendly.com",
  "eventbrite.com",
  "meetup.com",
  "mailchimp.com",
  "sendgrid.com",
  "intercom.io",
  "brevo.com",
]);

/** Sending-only subdomains companies use for bulk mail (`news.acme.com`). */
const BULK_SUBDOMAIN =
  /^(e|em|email|emails|mail|mailer|mailing|news|newsletter|newsletters|notify|notification|notifications|marketing|updates|bounce|bounces|reply|replies|campaign|campaigns|crm|info|lists?|msg|t|go)\./;

/** Local parts only machines use; matched against the part before any `+`. */
const AUTOMATED_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|no_reply|noreply-\w+|notifications?|notify|notifier|mailer-daemon|mailerdaemon|postmaster|bounces?|bounce-.*|alerts?|automated|auto-?confirm|auto-?reply|newsletters?|digest|mailer|daemon|robot|bot|calendar-notification|calendar|comments-noreply|receipts?|invoices?|billing-noreply|account-?security|security-?alerts?|verify|verification|system|unsubscribe)$/;

/** Shared role inboxes: sometimes a person reads them, often nobody. */
const ROLE_LOCAL =
  /^(info|hello|hi|hey|business|ceo|ceooffice|ceo-office|management|general|welcome|contactus|contact-us|mail|contact|sales|support|help|team|office|admin|hr|jobs|careers|press|media|billing|accounts|accounting|finance|service|services|enquiries|inquiries|feedback|partners|partnerships|marketing|events|community|legal|privacy|investors|ir|booking|bookings|orders|reception)$/;

export type CaptureSkipReason =
  | "invalid_address"
  | "self"
  | "teammate"
  | "automated_sender"
  | "automated_domain"
  | "bulk_header"
  | "bulk_category"
  | "mass_mail"
  | "auto_reply"
  | "calendar_notice"
  | "unanswered_inbound"
  | "room_or_resource"
  | "declined"
  | "large_meeting"
  | "not_a_meeting"
  | "bot_user"
  | "borderline_rejected"
  | "borderline_unjudged"
  | "duplicate"
  | "budget";

const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

function domainMatches(domain: string, list: ReadonlySet<string>): boolean {
  const parts = domain.split(".");
  for (let index = 0; index < parts.length - 1; index += 1)
    if (list.has(parts.slice(index).join("."))) return true;
  return false;
}

/** The company domain of an address; `null` for freemail. */
export function companyDomain(email: string): string | null {
  const domain = emailDomain(email);
  return domain && !FREEMAIL_DOMAINS.has(domain) ? domain : null;
}

/** Addresses of the owner and every member of the workspace. */
export interface CaptureIdentity {
  ownerEmails: ReadonlySet<string>;
  teammateEmails: ReadonlySet<string>;
}

export type AddressVerdict =
  | { ok: true; borderline: boolean }
  | { ok: false; reason: CaptureSkipReason };

/**
 * Whether an address can be a contact. `ownerInitiated` is true for people
 * the owner wrote to. `borderline` marks a shared role inbox, which only
 * becomes a contact when the judge says a person is behind it.
 */
export function classifyAddress(
  rawEmail: string,
  identity: CaptureIdentity,
  options: { ownerInitiated: boolean },
): AddressVerdict {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 320)
    return { ok: false, reason: "invalid_address" };
  if (identity.ownerEmails.has(email)) return { ok: false, reason: "self" };
  if (identity.teammateEmails.has(email))
    return { ok: false, reason: "teammate" };
  // A colleague at the owner's or a teammate's company is team, not a contact.
  const company = companyDomain(email);
  if (
    company &&
    [...identity.ownerEmails, ...identity.teammateEmails].some(
      (own) => companyDomain(own) === company,
    )
  )
    return { ok: false, reason: "teammate" };
  const local = email.slice(0, email.lastIndexOf("@")).split("+")[0] ?? "";
  if (AUTOMATED_LOCAL.test(local) || /no-?reply|donotreply/.test(local))
    return { ok: false, reason: "automated_sender" };
  const domain = emailDomain(email);
  if (
    domainMatches(domain, SENDING_INFRASTRUCTURE_DOMAINS) ||
    (!options.ownerInitiated &&
      domainMatches(domain, NOTIFICATION_PLATFORM_DOMAINS))
  )
    return { ok: false, reason: "automated_domain" };
  if (BULK_SUBDOMAIN.test(domain) && domain.split(".").length > 2)
    return { ok: false, reason: "automated_domain" };
  return { ok: true, borderline: ROLE_LOCAL.test(local) };
}

/** Headers that mark bulk or automatic mail (names lowercased). */
export function isBulkMail(headers: ReadonlyMap<string, string>): boolean {
  if (headers.has("list-unsubscribe") || headers.has("list-id")) return true;
  const precedence = headers.get("precedence")?.toLowerCase() ?? "";
  if (["bulk", "list", "junk", "auto_reply"].includes(precedence)) return true;
  const autoSubmitted = headers.get("auto-submitted")?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  return headers.has("x-auto-response-suppress") && headers.has("x-autoreply");
}

const BULK_CATEGORIES = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
  "SPAM",
  "TRASH",
]);

/** Gmail's tabs other than Primary, and spam. */
export function hasBulkCategory(labels: readonly string[]): boolean {
  return labels.some((label) => BULK_CATEGORIES.has(label.toUpperCase()));
}

const AUTO_REPLY_SUBJECT =
  /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|abwesenheitsnotiz|automatische antwort|réponse automatique|respuesta automática|undeliverable|delivery status notification|mail delivery (failed|subsystem))\b/i;

const CALENDAR_NOTICE_SUBJECT =
  /^(invitation|updated invitation|accepted|declined|tentatively accepted|canceled event|cancelled event|einladung|angenommen|abgelehnt)\b[^:]*:/i;

export function isAutoReplySubject(subject: string): boolean {
  return AUTO_REPLY_SUBJECT.test(subject.trim());
}

/** Invitations and RSVPs: the calendar source captures the meeting itself. */
export function isCalendarNoticeSubject(subject: string): boolean {
  return CALENDAR_NOTICE_SUBJECT.test(subject.trim());
}

/** A sent message to this many people is a mailing, not a conversation. */
export const MASS_MAIL_RECIPIENTS = 20;
/** A meeting with more attendees is an all-hands or a webinar. */
export const LARGE_MEETING_ATTENDEES = 25;
