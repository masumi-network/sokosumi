// Brand tokens and logo: apps/web/src/app/globals.css and public/images/logos.
// Keep the loopback page independent of the web app and remote resources.
const SOKOSUMI_LOGO =
  "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTG9nbyIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgdmlld0JveD0iMCAwIDE5MjAgMjQ5LjYiPgogIDxkZWZzPgogICAgPHN0eWxlPgogICAgICAuY2xzLTEgewogICAgICAgIGZpbGw6IG5vbmU7CiAgICAgIH0KCiAgICAgIC5jbHMtMiB7CiAgICAgICAgY2xpcC1wYXRoOiB1cmwoI2NsaXBwYXRoKTsKICAgICAgfQogICAgPC9zdHlsZT4KICAgIDxjbGlwUGF0aCBpZD0iY2xpcHBhdGgiPgogICAgICA8cmVjdCBjbGFzcz0iY2xzLTEiIHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjI0OS42Ii8+CiAgICA8L2NsaXBQYXRoPgogIDwvZGVmcz4KICA8ZyBjbGFzcz0iY2xzLTIiPgogICAgPGc+CiAgICAgIDxwYXRoIGQ9Ik01NTQuMiwwaC0yOC4zNnYyNDQuNDNoMjguMzZWMFoiLz4KICAgICAgPHBhdGggZD0iTTYxNS45MiwxMTcuODVjOC45NywzLjYyLDE3LjUzLDguMjMsMjUuNTEsMTMuODQsMTYuMzUtMTcuNzUsMjYuMzYtNDEuNDUsMjYuMzYtNjcuNDUsMC0yLjg0LS4xNC01LjY2LS4zNy04LjQ0aC0yNy45NGMuMzIsMi43Ny41MSw1LjU4LjUxLDguNDQsMCwyMS4zLTkuMzIsNDAuNDQtMjQuMDgsNTMuNloiLz4KICAgICAgPHBhdGggZD0iTTY1NS4wNCwxODYuOThjLS40OS0uODUtLjk2LTEuNjktMS40Ny0yLjUyLS4wOC0uMTMtLjE1LS4yNi0uMjMtLjM4LTE1LjIxLTI0LjczLTQxLjAyLTQyLjM0LTcxLjE3LTQ2LjY3djI3LjgzYzMyLjkyLDYuNDksNTcuODMsMzUuNjEsNTcuODMsNzAuNDQsMCwyLjk2LS4yLDUuODgtLjU0LDguNzRoMjcuOTVjLjI1LTIuODkuMzktNS44LjM5LTguNzQsMC0xNy42OC00LjY0LTM0LjMtMTIuNzUtNDguNzFoMFoiLz4KICAgICAgPHBhdGggZD0iTTE5MjAsNTUuODFoLTI3Ljh2MTg4LjYyaDI3LjhWNTUuODFaIi8+CiAgICAgIDxwYXRoIGQ9Ik0zOTcuODUsNzguNTNjMzkuOSwwLDcyLjM1LDMyLjE5LDcyLjM1LDcxLjc0cy0zMi40NSw3MS43NC03Mi4zNSw3MS43NC03Mi4zNS0zMi4xOS03Mi4zNS03MS43NCwzMi40NS03MS43NCw3Mi4zNS03MS43NFpNMzk3Ljg1LDUwLjk0Yy01NS4zMywwLTEwMC4xOSw0NC40Ny0xMDAuMTksOTkuMzNzNDQuODYsOTkuMzMsMTAwLjE5LDk5LjMzLDEwMC4xOC00NC40NywxMDAuMTgtOTkuMzMtNDQuODYtOTkuMzMtMTAwLjE4LTk5LjMzWiIvPgogICAgICA8cGF0aCBkPSJNMTEwNy40Niw1MC45NGMtNTUuMzMsMC0xMDAuMTksNDQuNDctMTAwLjE5LDk5LjMzaDI3LjgzYzAtMzkuNTYsMzIuNDUtNzEuNzQsNzIuMzUtNzEuNzRzNzIuMzUsMzIuMTksNzIuMzUsNzEuNzRoMjcuODNjMC01NC44NS00NC44Ni05OS4zMy0xMDAuMTgtOTkuMzNaIi8+CiAgICAgIDxwYXRoIGQ9Ik0xMDUxLjg3LDI0OS42YzU1LjMzLDAsMTAwLjE5LTQ0LjQ3LDEwMC4xOS05OS4zM2gtMjcuODNjMCwzOS41Ni0zMi40NSw3MS43NC03Mi4zNSw3MS43NHMtNzIuMzUtMzIuMTktNzIuMzUtNzEuNzRoLTI3LjgzYzAsNTQuODUsNDQuODYsOTkuMzMsMTAwLjE5LDk5LjMzWiIvPgogICAgICA8cGF0aCBkPSJNMTU1Ljc5LDUwLjk0Yy01NS4zMywwLTEwMC4xOSw0NC40Ny0xMDAuMTksOTkuMzNoMjcuODNjMC0zOS41NiwzMi40NS03MS43NCw3Mi4zNS03MS43NHM3Mi4zNSwzMi4xOSw3Mi4zNSw3MS43NGgyNy44M2MwLTU0Ljg1LTQ0Ljg2LTk5LjMzLTEwMC4xOS05OS4zM1oiLz4KICAgICAgPHBhdGggZD0iTTEwMC4xOSwyNDkuNmM1NS4zMywwLDEwMC4xOS00NC40NywxMDAuMTktOTkuMzNoLTI3LjgzYzAsMzkuNTYtMzIuNDUsNzEuNzQtNzIuMzUsNzEuNzRTMjcuODQsMTg5LjgyLDI3Ljg0LDE1MC4yN0gwQzAsMjA1LjEyLDQ0Ljg3LDI0OS42LDEwMC4xOSwyNDkuNloiLz4KICAgICAgPHBhdGggZD0iTTgwOS44LDc4LjUzYzM5LjksMCw3Mi4zNSwzMi4xOSw3Mi4zNSw3MS43NHMtMzIuNDYsNzEuNzQtNzIuMzUsNzEuNzQtNzIuMzYtMzIuMTktNzIuMzYtNzEuNzQsMzIuNDYtNzEuNzQsNzIuMzYtNzEuNzRaTTgwOS44LDUwLjk0Yy01NS4zMywwLTEwMC4xOSw0NC40Ny0xMDAuMTksOTkuMzNzNDQuODYsOTkuMzMsMTAwLjE5LDk5LjMzLDEwMC4xOC00NC40NywxMDAuMTgtOTkuMzMtNDQuODYtOTkuMzMtMTAwLjE4LTk5LjMzWiIvPgogICAgICA8cGF0aCBkPSJNMTQyMS45NSw1NS44MnY5My40OWMwLDM5Ljk0LTMyLjQ1LDcyLjQzLTcyLjM1LDcyLjQzcy03Mi4zNS0zMi41LTcyLjM1LTcyLjQzVjU1LjgyaC0yNy44M3Y5My40OWMwLDU1LjM5LDQ0Ljg2LDEwMC4yOSwxMDAuMTksMTAwLjI5czEwMC4xOC00NC45MSwxMDAuMTgtMTAwLjI5VjU1LjgyaC0yNy44M1oiLz4KICAgICAgPHBhdGggZD0iTTQ0Ny45NCwwaC0xMDAuMTh2MjcuODNoMTAwLjE4VjBaIi8+CiAgICAgIDxwYXRoIGQ9Ik0xNTA1LjQ4LDI0NC40M3YtOTMuNDljMC0zOS45NCwzMi40NS03Mi40Myw3Mi4zNS03Mi40M3M3Mi4zNSwzMi41LDcyLjM1LDcyLjQzdjkzLjQ5aDI3Ljgzdi05My40OWMwLTU1LjM5LTQ0Ljg2LTEwMC4yOS0xMDAuMTktMTAwLjI5cy0xMDAuMTgsNDQuOTEtMTAwLjE4LDEwMC4yOXY5My40OWgyNy44M1oiLz4KICAgICAgPHBhdGggZD0iTTE3NTAuMiw1MC42NGMtMjYuMDUsMC00OS43Nyw5Ljk2LTY3LjU4LDI2LjI2LDUuNjUsNy45NywxMC4zMiwxNi41LDEzLjk2LDI1LjQ1LDEzLjI1LTE0LjY0LDMyLjM4LTIzLjg2LDUzLjYyLTIzLjg2LDM5LjksMCw3Mi4zNSwzMi41LDcyLjM1LDcyLjQzdjkzLjQ5aDI3Ljgzdi05My40OWMwLTU1LjM5LTQ0Ljg2LTEwMC4yOS0xMDAuMTktMTAwLjI5aDBaIi8+CiAgICAgIDxwYXRoIGQ9Ik0xOTIwLC4wN2gtMjcuOHYyNy44M2gyNy44Vi4wN1oiLz4KICAgIDwvZz4KICA8L2c+Cjwvc3ZnPg==";

const CALLBACK_STYLE = `
:root {
  color-scheme:light dark;
  --background:hsl(0 0% 100%);
  --foreground:hsl(0 0% 4%);
  --card-background:hsl(0 0% 98%);
  --muted-foreground:hsl(0 0% 44%);
  --border:hsl(0 0% 88.6%);
  --primary:hsl(201.8 47.2% 32%);
  --primary-quinary:hsl(205.7 22.6% 93.9%);
  --destructive:hsl(0 74% 42%);
}

@media(prefers-color-scheme:dark) {
  :root {
    --background:#121212;
    --foreground:hsl(0 0% 98%);
    --card-background:hsl(0 0% 11%);
    --muted-foreground:hsl(0 0% 72%);
    --border:hsl(0 0% 20.4%);
    --primary:hsl(201.9 46.9% 48%);
    --primary-quinary:hsl(202.5 30.8% 10.2%);
    --destructive:hsl(0 84% 60%);
  }
  .logo {
    filter:invert(1);
  }
}

* {
  box-sizing:border-box;
}

body {
  margin:0;
  background:var(--background);
  color:var(--foreground);
  font:1rem/1.6 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  min-height:100svh;
  display:flex;
  flex-direction:column;
}

header {
  padding:32px 40px;
  display:flex;
  align-items:center;
  gap:20px;
}

.logo {
  width:140px;
  height:auto;
}

header span {
  color:var(--muted-foreground);
  border-left:1px solid var(--border);
  padding-left:20px;
  font-size:.8125rem;
}

main {
  flex:1;
  display:grid;
  place-items:center;
  padding:32px 24px 80px;
}

.content {
  width:100%;
  max-width:460px;
}

.status-icon {
  width:56px;
  height:56px;
  border-radius:14px;
  background:var(--primary-quinary);
  color:var(--primary);
  display:grid;
  place-items:center;
  margin-bottom:28px;
}

.status-icon svg {
  width:28px;
  height:28px;
}

.eyebrow {
  font-size:.75rem;
  font-weight:600;
  letter-spacing:.09em;
  color:var(--primary);
  margin:0 0 12px;
}

h1 {
  font-size:2.25rem;
  font-weight:600;
  line-height:1.15;
  letter-spacing:-.04em;
  margin:0 0 20px;
}

.intro {
  font-size:1rem;
  color:var(--muted-foreground);
  margin:0 0 28px;
}

.next {
  padding:24px;
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--card-background);
}

.next-label {
  font-size:.8125rem;
  font-weight:600;
  margin:0 0 16px;
}

.steps {
  margin:0;
  padding-left:23px;
  font-size:.9375rem;
}

.steps li {
  padding-left:7px;
}

.steps li+li {
  margin-top:12px;
}

.note {
  font-size:.8125rem;
  color:var(--muted-foreground);
  margin:22px 0 0;
}

.note svg {
  width:14px;
  height:14px;
  vertical-align:-2px;
  margin-right:6px;
}

footer {
  padding:24px 40px;
  color:var(--muted-foreground);
  font-size:.75rem;
}

body.error .status-icon {
  background:var(--card-background);
  color:var(--destructive);
}

body.error .eyebrow {
  color:var(--destructive);
}

@media(max-width:540px) {
  header {
    padding:24px;
    gap:16px;
  }
  .logo {
    width:116px;
  }
  header span {
    padding-left:16px;
    font-size:.75rem;
  }
  main {
    padding:32px 24px 48px;
  }
  h1 {
    font-size:1.875rem;
  }
  .next {
    padding:20px;
  }
  footer {
    padding:24px;
  }
}

`;

export function renderOAuthCallbackPage(isValid: boolean): string {
  const title = isValid
    ? "Return to your terminal"
    : "Sign-in could not continue";
  const icon = isValid
    ? '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>'
    : '<path d="M12 8v4m0 4h.01"/><circle cx="12" cy="12" r="9"/>';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>${title} | Sokosumi</title>
    <script>window.history.replaceState(null, "", window.location.pathname);</script>
    <style>${CALLBACK_STYLE}</style>
  </head>
  <body class="${isValid ? "" : "error"}">
    <header>
      <img class="logo" src="${SOKOSUMI_LOGO}" alt="Sokosumi">
      <span>Developer CLI</span>
    </header>
    <main>
      <div class="content">
        <div class="status-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
        </div>
        <p class="eyebrow">${isValid ? "BROWSER STEP COMPLETE" : "SIGN-IN INTERRUPTED"}</p>
        <h1>${title}</h1>
        <p class="intro">${
          isValid
            ? "Your browser has sent the sign-in request to the CLI. Your terminal will confirm whether sign-in succeeds."
            : "Sokosumi could not accept this sign-in request. Your terminal has the details."
        }</p>
        <section class="next" aria-label="Next steps">
          <p class="next-label">${isValid ? "Finish in your terminal" : "Try again from the CLI"}</p>
          <ol class="steps">
            <li>${isValid ? "Check your terminal for the sign-in result." : "Return to your terminal and check the error."}</li>
            <li>${isValid ? "Then close this browser tab." : "Start sign-in again, then close this tab."}</li>
          </ol>
        </section>
        <p class="note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
          No sign-in credentials are shown on this page.
        </p>
      </div>
    </main>
    <footer>Sokosumi · Developer CLI sign-in</footer>
  </body>
</html>`;
}
