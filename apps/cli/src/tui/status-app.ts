import {
  Box,
  render as defaultRender,
  type RenderOptions,
  Text,
  useApp,
  useInput,
} from "ink";
import React, { useEffect, useRef, useState } from "react";

import {
  type AuthEnvironment,
  type AuthManager,
  getAuthManager,
} from "../auth/auth-manager.js";
import {
  type InitialAuthState,
  resolveInitialAuth,
  selectBootRoute,
} from "../auth/bootstrap.js";
import {
  type CliTargetConfig,
  resolveCliConfig,
  resolveTargetScope,
  targetFromUserApiKey,
} from "../auth/config.js";
import { type AuthLoginOptions, runAuthLogin } from "../cli/auth-login.js";
import {
  COWORKER_FRAMEWORK_PRESETS,
  describeRegisterNextStep,
  presetForKey,
} from "../coworker/presets.js";

export interface StatusAppOptions {
  render?: (
    node: React.ReactNode,
    options?: RenderOptions,
  ) => {
    waitUntilExit(): Promise<void>;
  };
  authManager?: AuthManager;
  loginFn?: AuthLoginOptions["loginFn"];
  readStdin?: () => string;
  env?: AuthEnvironment;
  config?: CliTargetConfig;
}

type AuthScreen =
  | "home"
  | "auth-method"
  | "oauth-target"
  | "oauth-confirm"
  | "api-key-input"
  | "api-key-target"
  | "register";

type TerminalInput = NodeJS.ReadStream & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => TerminalInput;
};

function readApiKeyFromTerminal(
  input: TerminalInput = process.stdin as TerminalInput,
  output: NodeJS.WriteStream = process.stdout,
): Promise<string> {
  if (!input.isTTY || !input.setRawMode) {
    return Promise.reject(
      new Error(
        "API key input needs a TTY. Use SOKOSUMI_API_KEY or --api-key-stdin instead.",
      ),
    );
  }

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer | string) => {
      const inputValue = String(chunk);
      for (const character of inputValue) {
        if (character === "\u0003") {
          finish("reject", new Error("API key input was cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          if (!value) {
            finish("reject", new Error("API key input was empty"));
          } else {
            finish("resolve", value);
          }
          return;
        }
        if (character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    const finish = (
      kind: "resolve" | "reject",
      result: string | Error,
    ): void => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
      output.write("\n");
      if (kind === "resolve" && typeof result === "string") {
        resolve(result);
      } else {
        reject(result instanceof Error ? result : new Error(String(result)));
      }
    };

    output.write("API key (input hidden): ");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function getManagerForConfig(
  config: CliTargetConfig,
  env: AuthEnvironment,
): AuthManager {
  return getAuthManager({
    targetScope: resolveTargetScope(config.target, config.apiUrl),
    clientId: config.clientId,
    environment: env,
  });
}

function createTargetConfig(
  env: AuthEnvironment,
  target: "mainnet" | "preprod",
): CliTargetConfig {
  return resolveCliConfig({ env, preprod: target === "preprod" });
}

function StatusApp({
  authManager,
  loginFn,
  readStdin,
  env,
  config,
}: Required<Pick<StatusAppOptions, "authManager" | "env" | "config">> &
  Pick<StatusAppOptions, "loginFn" | "readStdin">) {
  const { exit } = useApp();
  const [authState, setAuthState] = useState<InitialAuthState>({
    authenticated: false,
    authMethod: null,
    expiresAt: null,
  });
  const [authResolved, setAuthResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [screen, setScreen] = useState<AuthScreen>("home");
  const [message, setMessage] = useState("");
  const [selectedConfig, setSelectedConfig] = useState(config);
  const [pendingApiKey, setPendingApiKey] = useState<string | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const activeManager =
    selectedConfig.apiUrl === config.apiUrl
      ? authManager
      : getManagerForConfig(selectedConfig, env);

  useEffect(() => {
    let cancelled = false;
    setAuthResolved(false);
    void resolveInitialAuth({
      authManager: activeManager,
      config: selectedConfig,
      environment: env,
    })
      .then((nextState) => {
        if (cancelled) return;
        setAuthState(nextState);
        setAuthResolved(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAuthState({
          authenticated: false,
          authMethod: null,
          expiresAt: null,
        });
        setMessage(error instanceof Error ? error.message : String(error));
        setAuthResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeManager, env, selectedConfig]);

  const route = selectBootRoute({
    authResolved,
    hasAuth: authState.authenticated,
  });

  const completeLogin = (nextState: InitialAuthState, nextMessage = "") => {
    setAuthState(nextState);
    setScreen("home");
    setMessage(nextMessage);
  };

  const startOAuthLogin = (loginConfig: CliTargetConfig) => {
    const manager = getManagerForConfig(loginConfig, env);
    const controller = new AbortController();
    abortController.current = controller;
    setBusy(true);
    setMessage("Browser opened. Finish sign-in there; waiting for callback…");
    void runAuthLogin({
      env,
      config: loginConfig,
      targetExplicit: true,
      loginFn,
      authManager: manager,
      stdout: { write: () => undefined },
      signal: controller.signal,
    })
      .then((result) => {
        completeLogin({
          authenticated: true,
          authMethod: result.authMethod,
          expiresAt: result.expiresAt,
        });
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        abortController.current = null;
        setBusy(false);
      });
  };

  const startApiKeyLogin = (apiKey: string, loginConfig: CliTargetConfig) => {
    const manager = getManagerForConfig(loginConfig, env);
    setBusy(true);
    void runAuthLogin({
      env,
      config: loginConfig,
      targetExplicit: true,
      apiKey,
      authManager: manager,
      stdout: { write: () => undefined },
    })
      .then((result) => {
        const warning = manager.isApiKeyPersistent()
          ? ""
          : "API key kept in memory for this run. Configure a vault to persist it.";
        completeLogin(
          {
            authenticated: true,
            authMethod: result.authMethod,
            expiresAt: result.expiresAt,
          },
          warning,
        );
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(false));
  };

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      abortController.current?.abort();
      exit();
      return;
    }
    if (busy) return;

    if (route === "auth") {
      if (screen === "auth-method") {
        if (input === "o" || input === "1") {
          setScreen("oauth-target");
          setMessage("");
        } else if (input === "a" || input === "2") {
          const envApiKey = String(env.SOKOSUMI_API_KEY || "").trim();
          if (envApiKey) {
            const detectedTarget = targetFromUserApiKey(envApiKey);
            const nextConfig =
              detectedTarget === "preprod"
                ? createTargetConfig(env, "preprod")
                : detectedTarget === "mainnet"
                  ? createTargetConfig(env, "mainnet")
                  : selectedConfig;
            startApiKeyLogin(envApiKey, nextConfig);
          } else {
            setScreen("api-key-input");
            setBusy(true);
            setMessage("Paste the user API key, then press Enter.");
            const inputPromise = readStdin
              ? Promise.resolve().then(() => readStdin())
              : readApiKeyFromTerminal();
            void inputPromise.then(
              (apiKey) => {
                setBusy(false);
                const detectedTarget = targetFromUserApiKey(apiKey);
                if (detectedTarget) {
                  const nextConfig = createTargetConfig(env, detectedTarget);
                  setSelectedConfig(nextConfig);
                  startApiKeyLogin(apiKey, nextConfig);
                  return;
                }
                setPendingApiKey(apiKey);
                setScreen("api-key-target");
                setMessage("Legacy key. Choose its target.");
              },
              (error: unknown) => {
                setBusy(false);
                setMessage(
                  error instanceof Error ? error.message : String(error),
                );
              },
            );
          }
        }
        return;
      }
      if (screen === "oauth-target") {
        if (input === "1") {
          const nextConfig = createTargetConfig(env, "mainnet");
          setSelectedConfig(nextConfig);
          setScreen("oauth-confirm");
          setMessage("");
        } else if (input === "2") {
          const nextConfig = createTargetConfig(env, "preprod");
          setSelectedConfig(nextConfig);
          setScreen("oauth-confirm");
          setMessage("");
        } else if (input === "b") {
          setScreen("auth-method");
        }
        return;
      }
      if (screen === "oauth-confirm") {
        if (input === "b") {
          setScreen("oauth-target");
        } else if (input === "o" || input === "1" || key.return) {
          startOAuthLogin(selectedConfig);
        }
        return;
      }
      if (screen === "api-key-target") {
        if (input === "1" || input === "2") {
          const target = input === "2" ? "preprod" : "mainnet";
          const nextConfig = createTargetConfig(env, target);
          setSelectedConfig(nextConfig);
          setScreen("home");
          if (pendingApiKey) startApiKeyLogin(pendingApiKey, nextConfig);
        } else if (input === "b") {
          setPendingApiKey(null);
          setScreen("auth-method");
        }
        return;
      }
      if (screen === "api-key-input") return;
      if (input === "o" || input === "1") {
        setScreen("oauth-target");
      } else if (input === "a" || input === "2") {
        setScreen("auth-method");
      }
      return;
    }

    if (route !== "signed-in") return;
    if (screen === "register") {
      if (input === "b") {
        setScreen("home");
        setMessage("");
        return;
      }
      const preset = presetForKey(input);
      if (preset) setMessage(describeRegisterNextStep(preset));
      return;
    }
    if (input === "r") {
      setScreen("register");
      setMessage("");
      return;
    }
    if (input === "x") {
      activeManager.logout();
      setAuthState({ authenticated: false, authMethod: null, expiresAt: null });
      setScreen("auth-method");
      setMessage("Signed out.");
    }
  });

  if (route === "boot") {
    return React.createElement(Text, null, "Checking session…");
  }

  if (route === "auth") {
    if (screen === "oauth-target") {
      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Choose OAuth target"),
        React.createElement(Text, null, "1 mainnet"),
        React.createElement(Text, null, "2 preprod"),
        React.createElement(Text, { dimColor: true }, "b back · q quit"),
        message ? React.createElement(Text, null, message) : null,
      );
    }
    if (screen === "oauth-confirm") {
      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Open browser sign-in?"),
        React.createElement(Text, null, `Target: ${selectedConfig.target}`),
        React.createElement(
          Text,
          { dimColor: true },
          "enter or o sign in · b back · q quit",
        ),
        message ? React.createElement(Text, null, message) : null,
      );
    }
    if (screen === "api-key-input") {
      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "User API key"),
        React.createElement(
          Text,
          null,
          "Input is hidden. Press Enter when complete.",
        ),
        React.createElement(
          Text,
          { dimColor: true },
          "escape or Ctrl+C cancels · q quits",
        ),
        message ? React.createElement(Text, null, message) : null,
      );
    }
    if (screen === "api-key-target") {
      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(
          Text,
          { bold: true },
          "Choose legacy API-key target",
        ),
        React.createElement(Text, null, "1 mainnet"),
        React.createElement(Text, null, "2 preprod"),
        React.createElement(Text, { dimColor: true }, "b back · q quit"),
        message ? React.createElement(Text, null, message) : null,
      );
    }
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Sokosumi CLI"),
      React.createElement(Text, null, "Choose sign-in method."),
      React.createElement(Text, null, "o or 1 browser OAuth"),
      React.createElement(Text, null, "a or 2 user API key"),
      React.createElement(Text, { dimColor: true }, "q quit"),
      message ? React.createElement(Text, null, message) : null,
    );
  }

  if (route === "signed-in" && screen === "register") {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Register a Coworker"),
      React.createElement(
        Text,
        { dimColor: true },
        "Pick the runtime. Chat and Tasks land after it is connected to one workspace.",
      ),
      ...COWORKER_FRAMEWORK_PRESETS.map((preset) =>
        React.createElement(
          Text,
          { key: preset.id },
          `${preset.key} ${preset.label}`,
        ),
      ),
      React.createElement(Text, { dimColor: true }, "b back · q quit"),
      message ? React.createElement(Text, null, message) : null,
    );
  }

  if (route === "signed-in") {
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Sokosumi CLI"),
      React.createElement(
        Text,
        null,
        `Signed in with ${authState.authMethod === "api-key" ? "a user API key" : "browser OAuth"}.`,
      ),
      React.createElement(Text, null, `Target: ${selectedConfig.target}`),
      React.createElement(
        Text,
        { dimColor: true },
        "r register a Coworker · x sign out · q quit",
      ),
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
      "o or 1 OAuth · a or 2 API key · q quit",
    ),
    message ? React.createElement(Text, null, message) : null,
  );
}

export async function renderStatusApp({
  render = defaultRender,
  authManager,
  loginFn,
  readStdin,
  env = process.env,
  config = resolveCliConfig({ env }),
}: StatusAppOptions = {}): Promise<{ tui: true }> {
  const manager = authManager || getManagerForConfig(config, env);
  const { waitUntilExit } = render(
    React.createElement(StatusApp, {
      authManager: manager,
      loginFn,
      readStdin,
      env,
      config,
    }),
  );
  await waitUntilExit();
  return { tui: true };
}
