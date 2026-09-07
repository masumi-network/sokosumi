import { Box, render as defaultRender, Text, useApp, useInput } from "ink";
import React, { useEffect, useState } from "react";

import { getAuthManager } from "../auth/auth-manager.mjs";
import { resolveInitialAuth, selectBootRoute } from "../auth/bootstrap.mjs";
import { runAuthLogin } from "../cli/auth-login.mjs";

function StatusApp({ authManager, loginFn, env }) {
  const { exit } = useApp();
  const [authResolved, setAuthResolved] = useState(false);
  const [hasAuth, setHasAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void resolveInitialAuth({ authManager }).then((signedIn) => {
      if (cancelled) return;
      setHasAuth(signedIn);
      setAuthResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [authManager]);

  const route = selectBootRoute({ authResolved, hasAuth });

  useInput((input, key) => {
    if (busy) return;
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (route === "auth" && (input === "l" || key.return)) {
      setBusy(true);
      setMessage("Opening browser…");
      void runAuthLogin({
        env,
        loginFn,
        authManager,
        stdout: { write: () => {} },
      })
        .then(() => {
          setHasAuth(true);
          setMessage("");
        })
        .catch((error) => {
          setMessage(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          setBusy(false);
        });
      return;
    }
    if (route === "signed-in" && input === "x") {
      authManager.logout();
      setHasAuth(false);
      setMessage("Signed out.");
    }
  });

  if (route === "boot") {
    return React.createElement(Text, null, "Checking session…");
  }

  if (route === "signed-in") {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Sokosumi CLI"),
      React.createElement(Text, null, "Signed in."),
      React.createElement(Text, { dimColor: true }, "x sign out · q quit"),
      message ? React.createElement(Text, null, message) : null,
    );
  }

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { bold: true }, "Sokosumi CLI"),
    React.createElement(Text, null, "Not signed in."),
    React.createElement(
      Text,
      { dimColor: true },
      "l or enter: sign in in the browser · q quit",
    ),
    message ? React.createElement(Text, null, message) : null,
  );
}

export async function renderStatusApp({
  render = defaultRender,
  authManager = getAuthManager(),
  loginFn,
  env = process.env,
} = {}) {
  const { waitUntilExit } = render(
    React.createElement(StatusApp, { authManager, loginFn, env }),
  );
  await waitUntilExit();
}
