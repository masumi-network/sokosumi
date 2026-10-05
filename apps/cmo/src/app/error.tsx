"use client";

interface ErrorPageProps {
  error: Error & { digest?: string };
  retry: () => void;
}

/**
 * The last resort when a page fails. Known sign-in failures go to the
 * signed-out page instead, which says what happened.
 */
export default function ErrorPage({ retry }: ErrorPageProps) {
  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>Something went wrong.</h1>
        <p className="lead">CMO could not load this page.</p>
        <button className="button" type="button" onClick={() => retry()}>
          Try again
        </button>
      </div>
    </main>
  );
}
