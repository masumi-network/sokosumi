import {
  Box,
  render as defaultRender,
  type RenderOptions,
  Text,
  useApp,
  useInput,
} from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  type CoreHttpClient,
  createCoreHttpClient,
} from "../api/http-client.js";
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
  MAINNET_API_URL,
  PREPROD_API_URL,
  resolveCliConfig,
  resolveTargetScope,
  sanitizeApiUrl,
  targetFromUserApiKey,
  USER_API_KEY_PREFIX_BY_TARGET,
  WEB_API_KEY_ROUTE,
} from "../auth/config.js";
import {
  DEFAULT_OAUTH_REDIRECT_PATH,
  DEFAULT_OAUTH_REDIRECT_PORT,
  OAUTH_LOOPBACK_HOST,
} from "../auth/oauth.js";
import { type AuthLoginOptions, runAuthLogin } from "../cli/auth-login.js";
import { CLI_VERSION } from "../cli/metadata.js";
import {
  COWORKER_FRAMEWORK_PRESETS,
  describeRegisterNextStep,
} from "../coworker/presets.js";
import { type ResourceKind, ResourceView } from "./resource-view.js";
import { SelectInput, type SelectItem } from "./select-input.js";
import { TUI_THEME } from "./theme.js";

export interface StatusAppOptions {
  render?: (
    node: React.ReactNode,
    options?: RenderOptions,
  ) => {
    waitUntilExit(): Promise<void>;
  };
  authManager?: AuthManager;
  authManagerFactory?: AuthManagerFactory;
  coreClient?: CoreHttpClient;
  loginFn?: AuthLoginOptions["loginFn"];
  oauthPort?: number;
  oauthCallbackPath?: string;
  env?: AuthEnvironment;
  config?: CliTargetConfig;
  clientIdOverride?: string;
  targetExplicit?: boolean;
}

type AuthScreen =
  | "home"
  | "auth-method"
  | "oauth-target"
  | "oauth-confirm"
  | "oauth-wait"
  | "api-key-input"
  | "api-key-target"
  | "api-key-wait"
  | "register"
  | "success"
  | "error"
  | ResourceKind;

function adaptSelectHandler<T>(
  handler: (value: T) => void,
): (value: unknown) => void {
  return (value) => handler(value as T);
}

type AuthMethod = "oauth" | "api-key";
type HostedTarget = "mainnet" | "preprod";
type OAuthConfirm = "sign-in";
type HomeAction = ResourceKind | "register" | "sign-out";
type SelectorItem<T> = SelectItem<T>;
type AuthPhase = "idle" | "waiting" | "success" | "error";

const LOGO = `┌─┐┌─┐┬┌─┌─┐┌─┐┬ ┬┌┬┐┬
└─┐│ │├┴┐│ │└─┐│ ││││││
└─┘└─┘┴ ┴└─┘└─┘└─┘┴ ┴┴`;
export function apiKeyCreationHint(environment: AuthEnvironment): string {
  const webUrl = String(environment.SOKOSUMI_WEB_URL || "").trim();
  if (!webUrl) return "Create one in the Sokosumi web app.";
  return `Create one at ${sanitizeApiUrl(webUrl)}${WEB_API_KEY_ROUTE}.`;
}

export function apiKeyPrefixHint(): string {
  return `${USER_API_KEY_PREFIX_BY_TARGET.mainnet}… / ${USER_API_KEY_PREFIX_BY_TARGET.preprod}…`;
}

export function oauthCallbackDisplayUri(
  port = DEFAULT_OAUTH_REDIRECT_PORT,
  callbackPath = DEFAULT_OAUTH_REDIRECT_PATH,
): string {
  const normalizedPath = callbackPath.startsWith("/")
    ? callbackPath
    : `/${callbackPath}`;
  return `http://${OAUTH_LOOPBACK_HOST}:${port}${normalizedPath}`;
}

type AuthManagerFactory = (options: {
  targetScope: string;
  clientId: string;
  environment: AuthEnvironment;
}) => AuthManager;

function getManagerForConfig(
  config: CliTargetConfig,
  env: AuthEnvironment,
  authManagerFactory: AuthManagerFactory = getAuthManager,
): AuthManager {
  return authManagerFactory({
    targetScope: resolveTargetScope(config.target, config.apiUrl),
    clientId: config.clientId,
    environment: env,
  });
}

export function resolveHostedTargetConfig(
  env: AuthEnvironment,
  target: HostedTarget,
  overrides: Partial<Pick<CliTargetConfig, "clientId">> = {},
): CliTargetConfig {
  return resolveCliConfig({
    env,
    apiUrl: target === "preprod" ? PREPROD_API_URL : MAINNET_API_URL,
    preprod: target === "preprod",
    ...overrides,
  });
}
export function explicitApiKeyTargetError(
  apiKey: string,
  config: CliTargetConfig,
  targetExplicit: boolean,
): string | null {
  if (!targetExplicit) return null;
  const detectedTarget = targetFromUserApiKey(apiKey);
  if (!detectedTarget) return null;
  if (config.target === "custom" || detectedTarget !== config.target) {
    return `API key belongs to ${detectedTarget}, but the explicit target is ${config.target}.`;
  }
  return null;
}

export function displayTargetLabel(config: CliTargetConfig): string {
  if (config.target !== "custom") return config.target;
  return sanitizeApiUrl(config.apiUrl);
}

export function apiKeyTargetEscapeState(_pendingApiKey: string | null): {
  screen: "auth-method";
  pendingApiKey: null;
} {
  return { screen: "auth-method", pendingApiKey: null };
}

function createTargetConfig(
  env: AuthEnvironment,
  target: HostedTarget,
  clientIdOverride?: string,
): CliTargetConfig {
  return resolveHostedTargetConfig(
    env,
    target,
    clientIdOverride ? { clientId: clientIdOverride } : {},
  );
}

function navigationHint({ back = false }: { back?: boolean } = {}) {
  return React.createElement(
    Text,
    { dimColor: true },
    back
      ? "Use arrows, then Enter · Esc back · q quit"
      : "Use arrows, then Enter · q quit",
  );
}

function titleBar(
  route: "boot" | "auth" | "signed-in",
  target: string | null,
  resource: string | null,
): React.ReactElement {
  const path =
    route === "signed-in"
      ? `workspace / ${resource || "dashboard"}`
      : route === "auth"
        ? "session / sign in"
        : "session / boot";
  return React.createElement(
    Box,
    {
      flexDirection: "row",
      justifyContent: "space-between",
      borderStyle: "single",
      borderColor: TUI_THEME.border,
      paddingX: 1,
      width: "100%",
    },
    React.createElement(
      Text,
      {
        color: TUI_THEME.foreground,
        backgroundColor: TUI_THEME.surface,
      },
      React.createElement(
        Text,
        { color: TUI_THEME.accent, bold: true },
        `● sokosumi v${CLI_VERSION}`,
      ),
      React.createElement(Text, { dimColor: true }, ` / ${path}`),
    ),
    React.createElement(
      Text,
      { dimColor: !target, color: target ? TUI_THEME.accent : undefined },
      target || "local session",
    ),
  );
}

function statusBar(
  route: "boot" | "auth" | "signed-in",
  target: string | null,
  authMethod: InitialAuthState["authMethod"],
  phase: AuthPhase,
  navFocus: boolean,
): React.ReactElement {
  const left =
    route === "signed-in"
      ? `● ${target || "unknown"} · ${authMethod === "api-key" ? "user API key" : "browser OAuth"}`
      : route === "boot"
        ? "checking session"
        : phase === "waiting"
          ? "waiting for sign-in"
          : "not signed in";
  const right =
    route === "signed-in"
      ? navFocus
        ? "←/→ tabs · Enter open · Esc exit · q quit"
        : "↑/↓ move · Enter inspect · Esc tabs · q quit"
      : route === "boot"
        ? ""
        : "↑/↓ move · Enter select · Esc back · q quit";
  return React.createElement(
    Box,
    {
      flexDirection: "row",
      justifyContent: "space-between",
      flexWrap: "wrap",
      borderStyle: "single",
      borderColor: TUI_THEME.border,
      paddingX: 1,
      width: "100%",
    },
    React.createElement(
      Text,
      {
        color: TUI_THEME.foreground,
        backgroundColor: TUI_THEME.surface,
        dimColor: route !== "signed-in",
      },
      left,
    ),
    React.createElement(
      Text,
      {
        color: TUI_THEME.muted,
        backgroundColor: TUI_THEME.surface,
        dimColor: true,
      },
      right,
    ),
  );
}

function terminalChrome({
  route,
  target,
  resource,
  authMethod,
  phase,
  navFocus,
  children,
}: {
  route: "boot" | "auth" | "signed-in";
  target: string | null;
  resource: string | null;
  authMethod: InitialAuthState["authMethod"];
  phase: AuthPhase;
  navFocus: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return React.createElement(
    Box,
    {
      flexDirection: "column",
      flexGrow: 1,
      width: "100%",
      borderStyle: "round",
      borderColor: TUI_THEME.border,
    },
    titleBar(route, target, resource),
    React.createElement(
      Box,
      { flexDirection: "column", flexGrow: 1, width: "100%" },
      children,
    ),
    statusBar(route, target, authMethod, phase, navFocus),
  );
}

function centeredScreen(...children: React.ReactNode[]): React.ReactElement {
  return React.createElement(
    Box,
    {
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      flexGrow: 1,
      width: "100%",
      paddingX: 1,
    },
    React.createElement(
      Box,
      {
        flexDirection: "column",
        width: "90%",
        alignSelf: "center",
      },
      ...children,
    ),
  );
}

function messageLine(
  message: string,
  phase: AuthPhase,
): React.ReactElement | null {
  if (!message) return null;
  return React.createElement(
    Text,
    {
      color:
        phase === "error"
          ? TUI_THEME.error
          : phase === "success"
            ? TUI_THEME.success
            : undefined,
    },
    message,
  );
}
function StatusApp({
  authManager,
  authManagerFactory,
  coreClient,
  loginFn,
  oauthPort,
  oauthCallbackPath,
  env,
  config,
  clientIdOverride,
  targetExplicit = false,
}: Required<Pick<StatusAppOptions, "authManager" | "env" | "config">> &
  Pick<
    StatusAppOptions,
    | "authManagerFactory"
    | "coreClient"
    | "loginFn"
    | "oauthPort"
    | "oauthCallbackPath"
    | "clientIdOverride"
  > & { targetExplicit?: boolean }) {
  const { exit } = useApp();
  const [authState, setAuthState] = useState<InitialAuthState>({
    authenticated: false,
    authMethod: null,
    expiresAt: null,
  });
  const [authResolved, setAuthResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [screen, setScreen] = useState<AuthScreen>("auth-method");
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<AuthPhase>("idle");
  const [selectedConfig, setSelectedConfig] = useState(config);
  const [pendingApiKey, setPendingApiKey] = useState<string | null>(null);
  const [apiKeyBuffer, setApiKeyBuffer] = useState("");
  const [navFocus, setNavFocus] = useState(true);
  const abortController = useRef<AbortController | null>(null);
  const apiKeyAttempt = useRef(0);
  const oauthAttempt = useRef(0);
  const apiKeyLoginAttempt = useRef(0);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeManager = useMemo(
    () =>
      selectedConfig.apiUrl === config.apiUrl
        ? authManager
        : getManagerForConfig(selectedConfig, env, authManagerFactory),
    [authManager, authManagerFactory, config.apiUrl, env, selectedConfig],
  );

  const resourceClient = useMemo(() => {
    if (!coreClient) return undefined;
    if (selectedConfig.apiUrl === config.apiUrl) return coreClient;
    return createCoreHttpClient({
      apiUrl: selectedConfig.apiUrl,
      authManager: activeManager,
      authBaseUrl: selectedConfig.authBaseUrl,
      clientId: selectedConfig.clientId,
      clientSecret: selectedConfig.clientSecret,
      environment: env,
    });
  }, [activeManager, config.apiUrl, coreClient, env, selectedConfig]);

  useEffect(() => {
    let cancelled = false;
    setAuthResolved(false);
    void resolveInitialAuth({
      authManager: activeManager,
      config: selectedConfig,
      environment: env,
      targetExplicit,
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
        setPhase("error");
        setScreen("error");
        setMessage(error instanceof Error ? error.message : String(error));
        setAuthResolved(true);
      });
    return () => {
      setPendingApiKey(null);
      cancelled = true;
    };
  }, [activeManager, env, selectedConfig, targetExplicit]);

  useEffect(
    () => () => {
      abortController.current?.abort();
      oauthAttempt.current += 1;
      apiKeyLoginAttempt.current += 1;
      apiKeyAttempt.current += 1;
      setPendingApiKey(null);
      if (successTimer.current) clearTimeout(successTimer.current);
    },
    [],
  );

  const route = selectBootRoute({
    authResolved,
    hasAuth: authState.authenticated,
  });

  const completeLogin = (nextState: InitialAuthState, nextMessage = "") => {
    setAuthState(nextState);
    setPhase("success");
    setScreen("success");
    setMessage(nextMessage || "Signed in successfully.");
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => {
      setPhase("idle");
      setScreen("home");
      setNavFocus(true);
    }, 650);
  };

  const startOAuthLogin = (loginConfig: CliTargetConfig) => {
    const manager = getManagerForConfig(loginConfig, env, authManagerFactory);
    const controller = new AbortController();
    const attempt = ++oauthAttempt.current;
    abortController.current = controller;
    setBusy(true);
    setPhase("waiting");
    setScreen("oauth-wait");
    setMessage("Opening browser sign-in and waiting for the callback...");
    void runAuthLogin({
      env,
      config: loginConfig,
      targetExplicit: true,
      loginFn,
      authManager: manager,
      stdout: { write: () => undefined },
      ...(oauthPort === undefined ? {} : { port: oauthPort }),
      ...(oauthCallbackPath === undefined
        ? {}
        : { callbackPath: oauthCallbackPath }),
      signal: controller.signal,
    })
      .then((result) => {
        if (attempt !== oauthAttempt.current || controller.signal.aborted)
          return;
        completeLogin({
          authenticated: true,
          authMethod: result.authMethod,
          expiresAt: result.expiresAt,
        });
      })
      .catch((error: unknown) => {
        if (attempt !== oauthAttempt.current || controller.signal.aborted)
          return;
        oauthAttempt.current += 1;
        abortController.current = null;
        setBusy(false);
        setPhase("error");
        setScreen("error");
        setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (attempt !== oauthAttempt.current) return;
        abortController.current = null;
        setBusy(false);
      });
  };

  const startApiKeyLogin = (
    apiKey: string,
    loginConfig: CliTargetConfig,
    loginTargetExplicit: boolean,
  ) => {
    const manager = getManagerForConfig(loginConfig, env, authManagerFactory);
    const controller = new AbortController();
    const attempt = ++apiKeyLoginAttempt.current;
    abortController.current = controller;
    setBusy(true);
    setPhase("waiting");
    setScreen("api-key-wait");
    setMessage("Validating API key...");
    void runAuthLogin({
      env,
      config: loginConfig,
      targetExplicit: loginTargetExplicit,
      apiKey,
      authManager: manager,
      stdout: { write: () => undefined },
      signal: controller.signal,
    })
      .then((result) => {
        if (attempt !== apiKeyLoginAttempt.current || controller.signal.aborted)
          return;
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
        if (attempt !== apiKeyLoginAttempt.current || controller.signal.aborted)
          return;
        setPendingApiKey(null);
        setPhase("error");
        setScreen("error");
        setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (attempt !== apiKeyLoginAttempt.current) return;
        abortController.current = null;
        setBusy(false);
      });
  };

  const processApiKey = (apiKey: string, attempt: number) => {
    if (attempt !== apiKeyAttempt.current) return;
    if (!apiKey.trim()) {
      setPendingApiKey(null);
      setBusy(false);
      setPhase("error");
      setScreen("error");
      setMessage("API key input was empty");
      return;
    }
    setApiKeyBuffer("");
    setBusy(false);
    const detectedTarget = targetFromUserApiKey(apiKey);
    const mismatch = explicitApiKeyTargetError(
      apiKey,
      selectedConfig,
      targetExplicit,
    );
    if (mismatch) {
      setPhase("error");
      setScreen("error");
      setPendingApiKey(null);
      setMessage(mismatch);
      return;
    }
    if (detectedTarget && !targetExplicit) {
      const nextConfig = createTargetConfig(
        env,
        detectedTarget,
        clientIdOverride,
      );
      setSelectedConfig(nextConfig);
      startApiKeyLogin(apiKey, nextConfig, targetExplicit);
      return;
    }
    if (!detectedTarget && !targetExplicit) {
      setPendingApiKey(apiKey);
      setScreen("api-key-target");
      setMessage("This key has no target prefix. Choose its target.");
      return;
    }
    startApiKeyLogin(apiKey, selectedConfig, true);
  };

  const beginApiKeyLogin = () => {
    const envApiKey = String(env.SOKOSUMI_API_KEY || "").trim();
    if (envApiKey) {
      const mismatch = explicitApiKeyTargetError(
        envApiKey,
        selectedConfig,
        targetExplicit,
      );
      if (mismatch) {
        setPhase("error");
        setScreen("error");
        setPendingApiKey(null);
        setMessage(mismatch);
        return;
      }
      const detectedTarget = targetFromUserApiKey(envApiKey);
      const nextConfig =
        !targetExplicit && detectedTarget === "preprod"
          ? createTargetConfig(env, "preprod", clientIdOverride)
          : !targetExplicit && detectedTarget === "mainnet"
            ? createTargetConfig(env, "mainnet", clientIdOverride)
            : selectedConfig;
      setSelectedConfig(nextConfig);
      startApiKeyLogin(envApiKey, nextConfig, targetExplicit);
      return;
    }

    setApiKeyBuffer("");
    setScreen("api-key-input");
    setPhase("idle");
    setBusy(true);
    setMessage("Paste the user API key, then press Enter.");
  };

  const cancelApiKeyInput = () => {
    setApiKeyBuffer("");
    apiKeyAttempt.current += 1;
    setBusy(false);
    setPhase("idle");
    setScreen("auth-method");
    setMessage("");
  };
  const cancelApiKeyLogin = () => {
    apiKeyLoginAttempt.current += 1;
    setPendingApiKey(null);
    abortController.current?.abort();
    abortController.current = null;
    setBusy(false);
    setPhase("idle");
    setScreen("auth-method");
    setMessage("");
  };

  useInput((input, key) => {
    const rawApiKeyInput = screen === "api-key-input";
    const interrupt = input === "\u0003" || (key.ctrl && input === "c");
    if (interrupt) {
      if (rawApiKeyInput) {
        cancelApiKeyInput();
      } else if (screen === "api-key-wait") {
        cancelApiKeyLogin();
      } else if (screen === "oauth-wait") {
        oauthAttempt.current += 1;
        abortController.current?.abort();
        setBusy(false);
        setPhase("idle");
        setScreen("oauth-confirm");
        setMessage("");
      } else {
        abortController.current?.abort();
        setBusy(false);
      }
      return;
    }
    if (rawApiKeyInput) {
      if (key.escape) {
        cancelApiKeyInput();
        return;
      }
      if (key.return) {
        processApiKey(apiKeyBuffer, apiKeyAttempt.current);
        return;
      }
      if (key.backspace || input === "\u007f") {
        setApiKeyBuffer((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setApiKeyBuffer((value) => value + input);
      }
      return;
    }
    if (input === "q" && !rawApiKeyInput) {
      if (screen === "oauth-wait") oauthAttempt.current += 1;
      if (screen === "api-key-wait") apiKeyLoginAttempt.current += 1;
      abortController.current?.abort();
      exit();
      return;
    }

    if (key.escape) {
      if (route === "auth") {
        if (screen === "oauth-wait" || screen === "api-key-wait") {
          if (screen === "api-key-wait") {
            cancelApiKeyLogin();
          } else {
            oauthAttempt.current += 1;
            abortController.current?.abort();
            setBusy(false);
            setScreen("oauth-confirm");
            setMessage("");
          }
          return;
        }
        if (screen === "api-key-target") {
          const reset = apiKeyTargetEscapeState(pendingApiKey);
          setPendingApiKey(reset.pendingApiKey);
          setScreen(reset.screen);
          setMessage("");
          return;
        }
        if (screen === "oauth-target") {
          setScreen("auth-method");
          setMessage("");
          return;
        }
        if (screen === "oauth-confirm") {
          setScreen("oauth-target");
          setMessage("");
          return;
        }
        if (screen === "success" || screen === "error") {
          setPendingApiKey(null);
          setPhase("idle");
          setScreen("auth-method");
          setMessage("");
          return;
        }
        exit();
        return;
      }

      if (route === "signed-in") {
        if (!navFocus) {
          setNavFocus(true);
          return;
        }
        exit();
        return;
      }
    }

    if (busy) return;

    if (route === "auth") {
      if (screen === "success" || screen === "error") return;
      return;
    }
  });

  const chooseAuthMethod = (method: AuthMethod) => {
    if (method === "oauth") {
      setScreen(targetExplicit ? "oauth-confirm" : "oauth-target");
      setPhase("idle");
      setMessage("");
      return;
    }
    beginApiKeyLogin();
  };

  const tabItems: SelectorItem<HomeAction>[] = [
    { value: "dashboard", label: "Dashboard" },
    { value: "agents", label: "Agents" },
    { value: "coworkers", label: "Coworkers" },
    { value: "tasks", label: "Tasks" },
    { value: "jobs", label: "Jobs" },
    { value: "account", label: "Account" },
    { value: "register", label: "Register", hint: "(soon)" },
    { value: "sign-out", label: "Sign out" },
  ];
  const activeResource: ResourceKind | "register" =
    screen === "home"
      ? "dashboard"
      : screen === "register"
        ? "register"
        : screen === "dashboard" ||
            screen === "agents" ||
            screen === "coworkers" ||
            screen === "tasks" ||
            screen === "jobs" ||
            screen === "account"
          ? screen
          : "dashboard";
  const tabIndex = Math.max(
    0,
    tabItems.findIndex((item) => item.value === activeResource),
  );

  const selectHomeAction = (action: HomeAction) => {
    if (action === "sign-out") {
      activeManager.logout();
      setAuthState({ authenticated: false, authMethod: null, expiresAt: null });
      setPhase("idle");
      setScreen("auth-method");
      setNavFocus(true);
      setMessage("Signed out.");
      return;
    }
    if (action === "register") {
      setScreen("register");
      setNavFocus(false);
      setMessage("");
      return;
    }
    setScreen(action);
    setNavFocus(false);
    setMessage("");
  };

  if (route === "boot") {
    return terminalChrome({
      route,
      target: null,
      resource: null,
      authMethod: null,
      phase,
      navFocus,
      children: centeredScreen(
        React.createElement(Text, { color: TUI_THEME.accent }, LOGO),
        React.createElement(Text, { bold: true }, "sokosumi · developer CLI"),
        React.createElement(Text, { dimColor: true }, "Checking session..."),
      ),
    });
  }

  if (route === "auth") {
    let content: React.ReactNode;
    if (screen === "oauth-target") {
      const items: SelectorItem<HostedTarget>[] = [
        { value: "mainnet", label: "Mainnet", hint: "production" },
        { value: "preprod", label: "Preprod", hint: "staging" },
      ];
      content = centeredScreen(
        React.createElement(Text, { color: TUI_THEME.accent }, LOGO),
        React.createElement(Text, { bold: true }, "Choose OAuth target"),
        React.createElement(
          Text,
          { dimColor: true },
          "Mainnet is production. Preprod is the staging network.",
        ),
        React.createElement(SelectInput, {
          items,
          onSelect: adaptSelectHandler<HostedTarget>((target) => {
            setSelectedConfig(
              createTargetConfig(env, target, clientIdOverride),
            );
            setScreen("oauth-confirm");
            setMessage("");
          }),
        }),
        navigationHint({ back: true }),
        messageLine(message, phase),
      );
    } else if (screen === "oauth-confirm") {
      const items: SelectorItem<OAuthConfirm>[] = [
        { value: "sign-in", label: "Open browser sign-in" },
      ];
      content = centeredScreen(
        React.createElement(Text, { color: TUI_THEME.accent }, LOGO),
        React.createElement(Text, { bold: true }, "Open browser sign-in?"),
        React.createElement(
          Text,
          { dimColor: true },
          `Target: ${selectedConfig.target} · client: ${selectedConfig.clientId}`,
        ),
        React.createElement(SelectInput, {
          items,
          onSelect: () => startOAuthLogin(selectedConfig),
          listen: !busy,
        }),
        navigationHint({ back: true }),
        messageLine(message, phase),
      );
    } else if (screen === "api-key-input") {
      content = centeredScreen(
        React.createElement(Text, { color: TUI_THEME.accent }, LOGO),
        React.createElement(Text, { bold: true }, "User API key"),
        React.createElement(
          Text,
          { dimColor: true },
          "Input is hidden. Press Enter when complete.",
        ),
        React.createElement(Text, { dimColor: true }, apiKeyCreationHint(env)),
        React.createElement(
          Text,
          { color: TUI_THEME.accent },
          "API key ···········",
        ),
        React.createElement(
          Text,
          { dimColor: true },
          "Ctrl+C or Esc cancels · q quits",
        ),
        messageLine(message, phase),
      );
    } else if (screen === "api-key-target") {
      const items: SelectorItem<HostedTarget>[] = [
        { value: "mainnet", label: "Mainnet", hint: "production" },
        { value: "preprod", label: "Preprod", hint: "staging" },
      ];
      content = centeredScreen(
        React.createElement(Text, { color: TUI_THEME.accent }, LOGO),
        React.createElement(Text, { bold: true }, "Choose API-key target"),
        React.createElement(
          Text,
          { dimColor: true },
          "This key has no target prefix. Choose its target.",
        ),
        React.createElement(SelectInput, {
          items,
          onSelect: adaptSelectHandler<HostedTarget>((target) => {
            const nextConfig = createTargetConfig(
              env,
              target,
              clientIdOverride,
            );
            setSelectedConfig(nextConfig);
            setPendingApiKey(null);
            if (pendingApiKey)
              startApiKeyLogin(pendingApiKey, nextConfig, true);
          }),
        }),
        navigationHint({ back: true }),
        messageLine(message, phase),
      );
    } else if (screen === "oauth-wait" || screen === "api-key-wait") {
      content = centeredScreen(
        React.createElement(Text, { color: TUI_THEME.accent }, LOGO),
        React.createElement(
          Text,
          { bold: true },
          screen === "oauth-wait" ? "Browser sign-in" : "API-key sign-in",
        ),
        React.createElement(
          Text,
          { dimColor: true },
          screen === "oauth-wait"
            ? `⠋ Waiting for callback on ${oauthCallbackDisplayUri(oauthPort, oauthCallbackPath)} …`
            : "⠋ Validating user API key …",
        ),
        React.createElement(Text, { dimColor: true }, message),
        React.createElement(Text, { dimColor: true }, "Esc cancels · q quits"),
      );
    } else if (screen === "success") {
      content = centeredScreen(
        React.createElement(
          Text,
          { color: TUI_THEME.success, bold: true },
          "✓ Sign-in successful",
        ),
        React.createElement(Text, { dimColor: true }, message),
        React.createElement(SelectInput, {
          items: [{ value: "continue", label: "Continue to workspace" }],
          onSelect: () => {
            if (successTimer.current) clearTimeout(successTimer.current);
            setPhase("idle");
            setScreen("home");
            setNavFocus(true);
          },
        }),
      );
    } else if (screen === "error") {
      content = centeredScreen(
        React.createElement(
          Text,
          { color: TUI_THEME.error, bold: true },
          "× Sign-in error",
        ),
        React.createElement(Text, null, message || "Unable to sign in."),
        React.createElement(SelectInput, {
          items: [{ value: "back", label: "Back to sign in" }],
          onSelect: () => {
            setPendingApiKey(null);
            setPhase("idle");
            setScreen("auth-method");
            setMessage("");
          },
        }),
        navigationHint({ back: true }),
      );
    } else {
      const items: SelectorItem<AuthMethod>[] = [
        {
          value: "oauth",
          label: "Browser OAuth",
          hint: "opens /signin · PKCE",
        },
        {
          value: "api-key",
          label: "User API key",
          hint: apiKeyPrefixHint(),
        },
      ];
      content = centeredScreen(
        React.createElement(Text, { color: TUI_THEME.accent }, LOGO),
        React.createElement(Text, { bold: true }, "Sign in"),
        React.createElement(
          Text,
          { dimColor: true },
          "Choose a sign-in method. Signup happens in the browser; the CLI never asks for a password.",
        ),
        React.createElement(SelectInput, {
          items,
          onSelect: adaptSelectHandler<AuthMethod>(chooseAuthMethod),
          listen: !busy,
        }),
        navigationHint(),
        messageLine(message, phase),
      );
    }
    return terminalChrome({
      route,
      target: displayTargetLabel(selectedConfig),
      resource: null,
      authMethod: null,
      phase,
      navFocus,
      children: content,
    });
  }

  if (screen === "success") {
    return terminalChrome({
      route: "signed-in",
      target: displayTargetLabel(selectedConfig),
      resource: null,
      authMethod: authState.authMethod,
      phase,
      navFocus,
      children: centeredScreen(
        React.createElement(
          Text,
          { color: TUI_THEME.success, bold: true },
          "✓ Sign-in successful",
        ),
        React.createElement(Text, { dimColor: true }, message),
        React.createElement(SelectInput, {
          items: [{ value: "continue", label: "Continue to workspace" }],
          onSelect: () => {
            if (successTimer.current) clearTimeout(successTimer.current);
            setPhase("idle");
            setScreen("home");
            setNavFocus(true);
          },
        }),
      ),
    });
  }

  const workspaceContent =
    activeResource === "register"
      ? React.createElement(
          Box,
          { flexDirection: "column", paddingX: 1, width: "100%" },
          React.createElement(
            Text,
            { color: TUI_THEME.accent, bold: true },
            React.createElement(
              React.Fragment,
              null,
              "/ register",
              React.createElement(Text, { dimColor: true }, " (soon)"),
            ),
          ),
          React.createElement(Text, { bold: true }, "Register a Coworker"),
          React.createElement(
            Text,
            { dimColor: true },
            "Choose a preset runtime. Registration stays preset-only; connection happens next.",
          ),
          React.createElement(SelectInput, {
            items: COWORKER_FRAMEWORK_PRESETS.map((preset) => ({
              value: preset.id,
              label: preset.label,
            })),
            onSelect: adaptSelectHandler<string>((presetId) => {
              const preset = COWORKER_FRAMEWORK_PRESETS.find(
                (candidate) => candidate.id === presetId,
              );
              if (preset) setMessage(describeRegisterNextStep(preset));
            }),
            listen: !busy && !navFocus,
          }),
          React.createElement(
            Text,
            { dimColor: true },
            "Esc returns to tabs · q quits",
          ),
          messageLine(message, phase),
        )
      : React.createElement(ResourceView, {
          resource: activeResource,
          coreClient: resourceClient,
          onBack: () => setNavFocus(true),
          onNavigate: (resource) => {
            setScreen(resource);
            setNavFocus(false);
            setMessage("");
          },
          listen: !navFocus,
          accountAuthMethod: authState.authMethod,
          accountTarget: selectedConfig.target,
        });

  return terminalChrome({
    route,
    target: displayTargetLabel(selectedConfig),
    resource: activeResource,
    authMethod: authState.authMethod,
    phase,
    navFocus,
    children: React.createElement(
      Box,
      { flexDirection: "column", flexGrow: 1, width: "100%" },
      React.createElement(SelectInput, {
        key: `${activeResource}-${navFocus ? "tabs" : "pane"}`,
        items: tabItems,
        initialIndex: tabIndex,
        direction: "horizontal",
        listen: navFocus,
        onSelect: adaptSelectHandler<HomeAction>(selectHomeAction),
      }),
      React.createElement(
        Box,
        { flexDirection: "column", flexGrow: 1, width: "100%", paddingY: 1 },
        workspaceContent,
        React.createElement(
          Box,
          {
            borderStyle: "single",
            borderColor: TUI_THEME.border,
            paddingX: 1,
            width: "100%",
          },
          React.createElement(Text, { color: TUI_THEME.accent }, "› "),
          React.createElement(
            Text,
            null,
            navFocus
              ? "select a tab"
              : "select a row · Enter inspect · Esc returns to tabs",
          ),
          React.createElement(Text, { dimColor: true }, ` · ${activeResource}`),
        ),
      ),
    ),
  });
}

export async function renderStatusApp({
  render = defaultRender,
  authManager,
  authManagerFactory,
  coreClient,
  loginFn,
  oauthPort,
  oauthCallbackPath,
  env = process.env,
  config = resolveCliConfig({ env }),
  clientIdOverride,
  targetExplicit = false,
}: StatusAppOptions = {}): Promise<{ tui: true }> {
  const manager =
    authManager || getManagerForConfig(config, env, authManagerFactory);
  const { waitUntilExit } = render(
    React.createElement(StatusApp, {
      authManager: manager,
      authManagerFactory,
      coreClient,
      loginFn,
      oauthPort,
      oauthCallbackPath,
      env,
      config,
      clientIdOverride,
      targetExplicit,
    }),
  );
  await waitUntilExit();
  return { tui: true };
}
