import { Logo } from "../components/logo";

/** A link to a page CMO does not have. */
export default function NotFound() {
  return (
    <main className="hero">
      <div className="hero-copy">
        <h1>This page is not here.</h1>
        <p className="lead">Check the link, or start again from home.</p>
        <a className="button" href="/">
          Go home
        </a>
      </div>
      <Logo lockup="framed" className="hero-logo" />
    </main>
  );
}
