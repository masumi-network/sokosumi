import type { ReactElement } from "react";

type Logo = (props: { className?: string }) => ReactElement;

const GmailLogo: Logo = ({ className }) => (
  <svg viewBox="52 42 88 66" className={className} aria-hidden>
    <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
    <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
    <path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
    <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
    <path
      fill="#c5221f"
      d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"
    />
  </svg>
);

const GoogleCalendarLogo: Logo = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path fill="#fff" d="M18 6H6v12h12z" />
    <path fill="#ea4335" d="M18 24l6-6h-6z" />
    <path fill="#fbbc04" d="M24 6h-6v12h6z" />
    <path fill="#34a853" d="M18 18H6v6h12z" />
    <path fill="#188038" d="M0 18v4a2 2 0 0 0 2 2h4v-6z" />
    <path fill="#1967d2" d="M24 6V2a2 2 0 0 0-2-2h-4v6z" />
    <path fill="#4285f4" d="M18 0H2a2 2 0 0 0-2 2v16h6V6h12z" />
    <path
      fill="#4285f4"
      d="M9.5 15.3c-.5-.3-.8-.8-1-1.4l1-.4c.1.4.3.7.5.9.3.2.6.3.9.3.4 0 .7-.1.9-.3.3-.2.4-.5.4-.9s-.1-.7-.4-.9c-.3-.2-.6-.3-1-.3h-.6v-1h.5c.3 0 .6-.1.8-.3.2-.2.3-.5.3-.8 0-.3-.1-.5-.3-.7-.2-.2-.5-.3-.8-.3-.3 0-.6.1-.8.3-.2.2-.3.4-.4.6l-1-.4c.1-.4.4-.8.8-1.1.4-.3.9-.5 1.4-.5.4 0 .8.1 1.1.3.3.2.6.4.8.7.2.3.3.7.3 1 0 .4-.1.7-.3 1-.2.3-.4.5-.7.6.4.1.7.4.9.7.2.3.3.7.3 1.1 0 .4-.1.8-.3 1.2-.2.3-.5.6-.9.8-.4.2-.8.3-1.2.3-.6 0-1.1-.2-1.5-.5zm6.2-4.9l-1.1.8-.5-.8 1.9-1.4h.7v6.6h-1z"
    />
  </svg>
);

const MicrosoftTeamsLogo: Logo = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <circle cx="19" cy="6.5" r="2.5" fill="#5059c9" />
    <path
      fill="#5059c9"
      d="M16 10h6a1 1 0 0 1 1 1v4.5a4 4 0 0 1-4 4h-.3A4 4 0 0 1 16 15.5z"
    />
    <circle cx="12.5" cy="5" r="3.5" fill="#7b83eb" />
    <path
      fill="#7b83eb"
      d="M7.5 10h10a1 1 0 0 1 1 1v5.5a6 6 0 0 1-12 0V11a1 1 0 0 1 1-1z"
    />
    <rect x="1" y="7" width="11" height="11" rx="1.5" fill="#4b53bc" />
    <path fill="#fff" d="M9.2 9.8H3.8v1.4h1.9v5h1.6v-5h1.9z" />
  </svg>
);

/** Official-colour marks for the providers the connect card offers. */
export const SOKO_BOT_PROVIDER_LOGOS: Record<string, Logo> = {
  gmail: GmailLogo,
  googlecalendar: GoogleCalendarLogo,
  microsoft_teams: MicrosoftTeamsLogo,
};
