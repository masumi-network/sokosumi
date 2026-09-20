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
import type { OrganizationWorkspace } from "../api/models/organization-workspace.js";
import type { Vendor } from "../api/models/vendor.js";
import { fetchOrganizationWorkspaces } from "../api/services/organization-workspace-service.js";
import { fetchVendorMemberships } from "../api/services/vendor-service.js";
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
import { SelectInput, type SelectItem } from "./select-input.js";
import { TUI_THEME } from "./theme.js";

export interface StatusAppOptions {
  render?: (
    node: React.ReactNode,
    options?: RenderOptions,
  ) => {
    waitUntilExit(): Promise<unknown>;
  };
  authManager?: AuthManager;
  authManagerFactory?: AuthManagerFactory;
  loginFn?: AuthLoginOptions["loginFn"];
  oauthPort?: number;
  oauthTimeoutMs?: number;
  env?: AuthEnvironment;
  config?: CliTargetConfig;
  clientIdOverride?: string;
  targetExplicit?: boolean;
  networkSelectionLocked?: boolean;
  coreClient?: CoreHttpClient;
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
  | "vendors"
  | "workspaces"
  | "manage"
  | "success"
  | "error";

type HomeAction = "register" | "vendors" | "workspaces" | "manage" | "sign-out";

function adaptSelectHandler<T>(
  handler: (value: T) => void,
): (value: unknown) => void {
  return (value) => handler(value as T);
}

type AuthMethod = "oauth" | "api-key";
type HostedTarget = "mainnet" | "preprod";
type OAuthConfirm = "sign-in";
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

export function apiKeyTargetEscapeState(): {
  screen: "auth-method";
  pendingApiKey: null;
} {
  return { screen: "auth-method", pendingApiKey: null };
}

export function resolveSelectedHostedTarget(
  config: CliTargetConfig,
): HostedTarget {
  return config.target === "preprod" ? "preprod" : "mainnet";
}

export function isNetworkSelectionLocked(
  config: CliTargetConfig,
  options: { preprod?: boolean; apiUrl?: string } = {},
): boolean {
  return Boolean(
    options.preprod || options.apiUrl || config.target === "custom",
  );
}

export function toggleHostedTarget(target: HostedTarget): HostedTarget {
  return target === "mainnet" ? "preprod" : "mainnet";
}

export function buildSignInMenuItems(): SelectorItem<AuthMethod>[] {
  return [
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

function navigationHint({
  back = false,
  showNetworkToggle = false,
}: {
  back?: boolean;
  showNetworkToggle?: boolean;
} = {}) {
  const parts = ["Use arrows, then Enter"];
  if (showNetworkToggle) parts.push("Tab switch network");
  if (back) parts.push("Esc back");
  parts.push("q quit");
  return React.createElement(Text, { dimColor: true }, parts.join(" · "));
}

function signedInIdentityLine(
  target: string,
  authMethod: NonNullable<InitialAuthState["authMethod"]>,
): React.ReactElement {
  const method = authMethod === "api-key" ? "user API key" : "browser OAuth";
  return React.createElement(
    Text,
    { dimColor: true },
    `Signed in · ${target} · ${method}`,
  );
}

function quietFrame({
  route,
  target,
  authMethod,
  children,
  showBackHint = false,
  showNavigationHint = true,
  showNetworkToggle = false,
}: {
  route: "boot" | "auth" | "signed-in";
  target: string | null;
  authMethod: InitialAuthState["authMethod"];
  children: React.ReactNode;
  showBackHint?: boolean;
  showNavigationHint?: boolean;
  showNetworkToggle?: boolean;
}): React.ReactElement {
  return React.createElement(
    Box,
    {
      flexDirection: "column",
      flexGrow: 1,
      width: "100%",
      borderStyle: "round",
      borderColor: TUI_THEME.border,
      paddingX: 1,
    },
    React.createElement(
      Box,
      { flexDirection: "row", justifyContent: "space-between", width: "100%" },
      React.createElement(
        Text,
        { color: TUI_THEME.accent, bold: true },
        `sokosumi v${CLI_VERSION}`,
      ),
      route === "auth"
        ? React.createElement(
            Text,
            { dimColor: !target, color: target ? TUI_THEME.accent : undefined },
            target || "local session",
          )
        : null,
    ),
    React.createElement(
      Box,
      { flexDirection: "column", flexGrow: 1, width: "100%", paddingY: 1 },
      children,
    ),
    route === "signed-in" && authMethod && target
      ? signedInIdentityLine(target, authMethod)
      : null,
    showNavigationHint
      ? navigationHint({ back: showBackHint, showNetworkToggle })
      : null,
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
  loginFn,
  oauthPort,
  oauthTimeoutMs,
  env,
  config,
  clientIdOverride,
  targetExplicit = false,
  networkSelectionLocked = false,
  coreClient: coreClientOverride,
}: Required<Pick<StatusAppOptions, "authManager" | "env" | "config">> &
  Pick<
    StatusAppOptions,
    | "authManagerFactory"
    | "loginFn"
    | "oauthPort"
    | "oauthTimeoutMs"
    | "clientIdOverride"
    | "coreClient"
  > & {
    targetExplicit?: boolean;
    networkSelectionLocked?: boolean;
  }) {
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
  const coreClient = useMemo(
    () =>
      coreClientOverride ??
      createCoreHttpClient({
        apiUrl: selectedConfig.apiUrl,
        authManager: activeManager,
        environment: env,
        clientId: selectedConfig.clientId,
        authBaseUrl: selectedConfig.authBaseUrl,
        clientSecret: selectedConfig.clientSecret,
      }),
    [
      activeManager,
      coreClientOverride,
      env,
      selectedConfig.apiUrl,
      selectedConfig.authBaseUrl,
      selectedConfig.clientId,
      selectedConfig.clientSecret,
    ],
  );
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [workspaces, setWorkspaces] = useState<OrganizationWorkspace[]>([]);
  const [resourceLoading, setResourceLoading] = useState(false);

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

  useEffect(() => {
    if (route !== "signed-in") return;
    if (screen !== "vendors" && screen !== "workspaces") return;
    let cancelled = false;
    setResourceLoading(true);
    setPhase("idle");
    setMessage("");
    void (async () => {
      try {
        if (screen === "vendors") {
          const { vendors: nextVendors } =
            await fetchVendorMemberships(coreClient);
          if (!cancelled) setVendors(nextVendors);
        } else {
          const { organizationWorkspaces } =
            await fetchOrganizationWorkspaces(coreClient);
          if (!cancelled) setWorkspaces(organizationWorkspaces);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setPhase("error");
          setMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setResourceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coreClient, route, screen]);

  const completeLogin = (nextState: InitialAuthState, nextMessage = "") => {
    setAuthState(nextState);
    setPhase("success");
    setScreen("success");
    setMessage(nextMessage || "Signed in successfully.");
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => {
      setPhase("idle");
      setScreen("home");
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
      ...(oauthTimeoutMs === undefined ? {} : { timeoutMs: oauthTimeoutMs }),
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
    if (
      key.tab &&
      route === "auth" &&
      screen === "auth-method" &&
      !networkSelectionLocked &&
      !busy
    ) {
      const current = resolveSelectedHostedTarget(selectedConfig);
      const next = toggleHostedTarget(current);
      setSelectedConfig(createTargetConfig(env, next, clientIdOverride));
      setMessage("");
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
          const reset = apiKeyTargetEscapeState();
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
          setScreen("auth-method");
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
        if (
          screen === "register" ||
          screen === "manage" ||
          screen === "vendors" ||
          screen === "workspaces"
        ) {
          setScreen("home");
          setMessage("");
          setPhase("idle");
          return;
        }
        exit();
        return;
      }
    }

    if (busy) return;

    if (route === "auth") {
      if (screen === "success" || screen === "error") return;
    }
  });

  const chooseAuthMethod = (method: AuthMethod) => {
    if (method === "oauth") {
      setScreen("oauth-confirm");
      setPhase("idle");
      setMessage("");
      return;
    }
    beginApiKeyLogin();
  };

  const handleSignInAction = (action: AuthMethod) => {
    chooseAuthMethod(action);
  };

  const homeItems: SelectorItem<HomeAction>[] = [
    { value: "register", label: "Register a Coworker" },
    { value: "vendors", label: "Vendors", hint: "memberships you administer" },
    {
      value: "workspaces",
      label: "Workspaces",
      hint: "organization workspaces",
    },
    { value: "manage", label: "Manage Coworker" },
    { value: "sign-out", label: "Sign out" },
  ];

  const selectHomeAction = (action: HomeAction) => {
    if (action === "sign-out") {
      activeManager.logout();
      setAuthState({ authenticated: false, authMethod: null, expiresAt: null });
      setPhase("idle");
      setScreen("auth-method");
      setMessage("Signed out.");
      return;
    }
    setScreen(action);
    setMessage("");
  };

  const targetLabel = displayTargetLabel(selectedConfig);

  if (route === "boot") {
    return quietFrame({
      route,
      target: null,
      authMethod: null,
      showNavigationHint: false,
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
            ? `⠋ Waiting for callback on ${oauthCallbackDisplayUri(oauthPort)} …`
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
          items: [{ value: "continue", label: "Continue" }],
          onSelect: () => {
            if (successTimer.current) clearTimeout(successTimer.current);
            setPhase("idle");
            setScreen("home");
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
      );
    } else {
      const items = buildSignInMenuItems();
      content = centeredScreen(
        React.createElement(Text, { color: TUI_THEME.accent }, LOGO),
        React.createElement(Text, { bold: true }, "Sign in"),
        React.createElement(
          Text,
          { dimColor: true },
          networkSelectionLocked
            ? `Target locked to ${targetLabel}. Choose a sign-in method. Signup happens in the browser; the CLI never asks for a password.`
            : "Choose a sign-in method. Press Tab to switch network. Signup happens in the browser; the CLI never asks for a password.",
        ),
        React.createElement(SelectInput, {
          items,
          onSelect: adaptSelectHandler<AuthMethod>(handleSignInAction),
          listen: !busy,
        }),
        messageLine(message, phase),
      );
    }
    const authScreensWithBack = new Set<AuthScreen>([
      "oauth-target",
      "oauth-confirm",
      "api-key-target",
      "error",
    ]);
    const authScreensWithCustomHint = new Set<AuthScreen>([
      "api-key-input",
      "oauth-wait",
      "api-key-wait",
    ]);
    return quietFrame({
      route,
      target: targetLabel,
      authMethod: null,
      showBackHint: authScreensWithBack.has(screen),
      showNavigationHint: !authScreensWithCustomHint.has(screen),
      showNetworkToggle:
        screen === "auth-method" && !networkSelectionLocked && !busy,
      children: content,
    });
  }

  if (screen === "success") {
    return quietFrame({
      route: "signed-in",
      target: targetLabel,
      authMethod: authState.authMethod,
      children: centeredScreen(
        React.createElement(
          Text,
          { color: TUI_THEME.success, bold: true },
          "✓ Sign-in successful",
        ),
        React.createElement(Text, { dimColor: true }, message),
        React.createElement(SelectInput, {
          items: [{ value: "continue", label: "Continue" }],
          onSelect: () => {
            if (successTimer.current) clearTimeout(successTimer.current);
            setPhase("idle");
            setScreen("home");
          },
        }),
      ),
    });
  }

  let signedInContent: React.ReactNode;
  if (screen === "register") {
    signedInContent = React.createElement(
      Box,
      { flexDirection: "column", width: "100%" },
      React.createElement(Text, { bold: true }, "Register a Coworker"),
      React.createElement(
        Text,
        { dimColor: true },
        "Choose a preset runtime. Registration stays preset-only until the runtime identity contract lands.",
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
        listen: !busy,
      }),
      messageLine(message, phase),
    );
  } else if (screen === "vendors") {
    const vendorItems: SelectorItem<string>[] = vendors.length
      ? vendors.map((vendor) => ({
          value: vendor.id,
          label: vendor.name || "Unnamed vendor",
          hint:
            vendor.role === "admin"
              ? "admin · can register Coworkers"
              : vendor.role || undefined,
        }))
      : [{ value: "empty", label: "No vendors found", hint: "empty" }];
    signedInContent = React.createElement(
      Box,
      { flexDirection: "column", width: "100%" },
      React.createElement(Text, { bold: true }, "Vendors"),
      React.createElement(
        Text,
        { dimColor: true },
        resourceLoading
          ? "Loading vendor memberships…"
          : "Admin role is required to register Coworkers under a Vendor.",
      ),
      React.createElement(SelectInput, {
        items: vendorItems,
        onSelect: adaptSelectHandler<string>((vendorId) => {
          if (vendorId === "empty") return;
          const vendor = vendors.find((candidate) => candidate.id === vendorId);
          if (!vendor) return;
          setPhase("idle");
          setMessage(
            `${vendor.name || vendor.id} · role ${vendor.role || "unknown"} · id ${vendor.id}`,
          );
        }),
        listen: !resourceLoading,
      }),
      messageLine(message, phase),
    );
  } else if (screen === "workspaces") {
    const workspaceItems: SelectorItem<string>[] = workspaces.length
      ? workspaces.map((workspace) => ({
          value: workspace.organizationId,
          label: workspace.name || "Unnamed workspace",
          hint: workspace.role || workspace.slug || undefined,
        }))
      : [
          {
            value: "empty",
            label: "No organization workspaces found",
            hint: "empty",
          },
        ];
    signedInContent = React.createElement(
      Box,
      { flexDirection: "column", width: "100%" },
      React.createElement(Text, { bold: true }, "Organization workspaces"),
      React.createElement(
        Text,
        { dimColor: true },
        resourceLoading
          ? "Loading organization workspaces…"
          : "Choose a workspace before registering a workspace-only Coworker.",
      ),
      React.createElement(SelectInput, {
        items: workspaceItems,
        onSelect: adaptSelectHandler<string>((organizationId) => {
          if (organizationId === "empty") return;
          const workspace = workspaces.find(
            (candidate) => candidate.organizationId === organizationId,
          );
          if (!workspace) return;
          setPhase("idle");
          setMessage(
            `${workspace.name || workspace.organizationId} · organization ${workspace.organizationId}${workspace.role ? ` · role ${workspace.role}` : ""}`,
          );
        }),
        listen: !resourceLoading,
      }),
      messageLine(message, phase),
    );
  } else if (screen === "manage") {
    signedInContent = React.createElement(
      Box,
      { flexDirection: "column", width: "100%" },
      React.createElement(Text, { bold: true }, "Manage Coworker"),
      React.createElement(
        Text,
        { dimColor: true },
        "Observability lives in Web and headless commands. Use the CLI for rename, API-key rotation, and inspection:",
      ),
      React.createElement(Text, null, "sokosumi coworkers list"),
      React.createElement(
        Text,
        null,
        "sokosumi coworkers update --id <id> --name <name>",
      ),
      React.createElement(Text, null, "sokosumi coworkers api-key --id <id>"),
    );
  } else {
    signedInContent = centeredScreen(
      React.createElement(Text, { color: TUI_THEME.accent }, LOGO),
      React.createElement(Text, { bold: true }, "Developer CLI"),
      React.createElement(
        Text,
        { dimColor: true },
        "Sign in is done. Review Vendors and Workspaces, then register or manage Coworkers.",
      ),
      React.createElement(SelectInput, {
        items: homeItems,
        onSelect: adaptSelectHandler<HomeAction>(selectHomeAction),
        listen: !busy,
      }),
      messageLine(message, phase),
    );
  }

  return quietFrame({
    route: "signed-in",
    target: targetLabel,
    authMethod: authState.authMethod,
    showBackHint:
      screen === "register" ||
      screen === "manage" ||
      screen === "vendors" ||
      screen === "workspaces",
    children: signedInContent,
  });
}

export async function renderStatusApp({
  render = defaultRender,
  authManager,
  authManagerFactory,
  loginFn,
  oauthPort,
  oauthTimeoutMs,
  env = process.env,
  config = resolveCliConfig({ env }),
  clientIdOverride,
  targetExplicit = false,
  networkSelectionLocked = false,
  coreClient,
}: StatusAppOptions = {}): Promise<{ tui: true }> {
  const manager =
    authManager || getManagerForConfig(config, env, authManagerFactory);
  const { waitUntilExit } = render(
    React.createElement(StatusApp, {
      authManager: manager,
      authManagerFactory,
      loginFn,
      oauthPort,
      oauthTimeoutMs,
      env,
      config,
      clientIdOverride,
      targetExplicit,
      networkSelectionLocked,
      coreClient,
    }),
  );
  await waitUntilExit();
  return { tui: true };
}
