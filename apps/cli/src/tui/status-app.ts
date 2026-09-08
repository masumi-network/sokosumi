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
  resolveCliConfig,
  resolveTargetScope,
  targetFromUserApiKey,
} from "../auth/config.js";
import { type AuthLoginOptions, runAuthLogin } from "../cli/auth-login.js";
import {
  COWORKER_FRAMEWORK_PRESETS,
  describeRegisterNextStep,
} from "../coworker/presets.js";
import { type ResourceKind, ResourceView } from "./resource-view.js";
import { SelectInput, type SelectItem } from "./select-input.js";

export interface StatusAppOptions {
  render?: (
    node: React.ReactNode,
    options?: RenderOptions,
  ) => {
    waitUntilExit(): Promise<void>;
  };
  authManager?: AuthManager;
  coreClient?: CoreHttpClient;
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
  | "register"
  | ResourceKind;

type TerminalInput = NodeJS.ReadStream & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => TerminalInput;
};
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
  target: HostedTarget,
): CliTargetConfig {
  return resolveCliConfig({ env, preprod: target === "preprod" });
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

function StatusApp({
  authManager,
  coreClient,
  loginFn,
  readStdin,
  env,
  config,
}: Required<Pick<StatusAppOptions, "authManager" | "env" | "config">> &
  Pick<StatusAppOptions, "coreClient" | "loginFn" | "readStdin">) {
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
  const activeManager = useMemo(
    () =>
      selectedConfig.apiUrl === config.apiUrl
        ? authManager
        : getManagerForConfig(selectedConfig, env),
    [authManager, config.apiUrl, env, selectedConfig],
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
    setMessage("Starting browser sign-in...");
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

  const beginApiKeyLogin = () => {
    const envApiKey = String(env.SOKOSUMI_API_KEY || "").trim();
    if (envApiKey) {
      const detectedTarget = targetFromUserApiKey(envApiKey);
      const nextConfig =
        detectedTarget === "preprod"
          ? createTargetConfig(env, "preprod")
          : detectedTarget === "mainnet"
            ? createTargetConfig(env, "mainnet")
            : selectedConfig;
      setSelectedConfig(nextConfig);
      startApiKeyLogin(envApiKey, nextConfig);
      return;
    }

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
        setMessage("This key has no target prefix. Choose its target.");
      },
      (error: unknown) => {
        setBusy(false);
        setMessage(error instanceof Error ? error.message : String(error));
      },
    );
  };

  useInput((input, key) => {
    if (input === "q") {
      abortController.current?.abort();
      exit();
      return;
    }
    if (key.escape && !busy) {
      if (route === "auth") {
        if (screen === "oauth-target" || screen === "api-key-target") {
          setScreen("auth-method");
          setMessage("");
          return;
        }
        if (screen === "oauth-confirm") {
          setScreen("oauth-target");
          setMessage("");
          return;
        }
      }
      if (route === "signed-in") {
        if (screen === "register" || screen === "home") {
          if (screen === "register") {
            setScreen("home");
            setMessage("");
            return;
          }
        } else {
          setScreen("home");
          setMessage("");
          return;
        }
      }
      exit();
      return;
    }
    if (busy) return;

    if (route === "auth") {
      if (screen === "auth-method") {
        return;
      }
      if (screen === "oauth-target") {
        return;
      }
      if (screen === "oauth-confirm") {
        return;
      }
      if (screen === "api-key-target") {
        return;
      }
      if (screen === "api-key-input") return;
      return;
    }

    if (route !== "signed-in") return;
    if (
      screen === "register" ||
      screen === "home" ||
      screen === "dashboard" ||
      screen === "agents" ||
      screen === "coworkers" ||
      screen === "tasks" ||
      screen === "jobs" ||
      screen === "account"
    )
      return;
  });

  if (route === "boot") {
    return React.createElement(Text, null, "Checking session...");
  }

  if (route === "auth") {
    if (screen === "oauth-target") {
      const items: SelectorItem<HostedTarget>[] = [
        { value: "mainnet", label: "Mainnet" },
        { value: "preprod", label: "Preprod" },
      ];
      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Choose OAuth target"),
        React.createElement(SelectInput, {
          items,
          onSelect: adaptSelectHandler<HostedTarget>((target) => {
            setSelectedConfig(createTargetConfig(env, target));
            setScreen("oauth-confirm");
            setMessage("");
          }),
        }),
        navigationHint({ back: true }),
        message ? React.createElement(Text, null, message) : null,
      );
    }
    if (screen === "oauth-confirm") {
      const items: SelectorItem<OAuthConfirm>[] = [
        { value: "sign-in", label: "Open browser sign-in" },
      ];
      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Open browser sign-in?"),
        React.createElement(Text, null, `Target: ${selectedConfig.target}`),
        React.createElement(SelectInput, {
          items,
          onSelect: () => startOAuthLogin(selectedConfig),
          listen: !busy,
        }),
        navigationHint({ back: true }),
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
          "Ctrl+C cancels · q quits",
        ),
        message ? React.createElement(Text, null, message) : null,
      );
    }
    if (screen === "api-key-target") {
      const items: SelectorItem<HostedTarget>[] = [
        { value: "mainnet", label: "Mainnet" },
        { value: "preprod", label: "Preprod" },
      ];
      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Choose API-key target"),
        React.createElement(SelectInput, {
          items,
          onSelect: adaptSelectHandler<HostedTarget>((target) => {
            const nextConfig = createTargetConfig(env, target);
            setSelectedConfig(nextConfig);
            setScreen("home");
            if (pendingApiKey) startApiKeyLogin(pendingApiKey, nextConfig);
            setPendingApiKey(null);
          }),
        }),
        navigationHint({ back: true }),
        message ? React.createElement(Text, null, message) : null,
      );
    }
    const items: SelectorItem<AuthMethod>[] = [
      { value: "oauth", label: "Browser OAuth" },
      { value: "api-key", label: "User API key" },
    ];
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Sokosumi CLI"),
      React.createElement(Text, null, "Choose sign-in method."),
      React.createElement(SelectInput, {
        items,
        onSelect: adaptSelectHandler<AuthMethod>((method) => {
          if (method === "oauth") {
            setScreen("oauth-target");
            setMessage("");
            return;
          }
          beginApiKeyLogin();
        }),
      }),
      navigationHint(),
      message ? React.createElement(Text, null, message) : null,
    );
  }

  if (route === "signed-in" && screen === "register") {
    const items: SelectorItem<string>[] = COWORKER_FRAMEWORK_PRESETS.map(
      (preset) => ({ value: preset.id, label: preset.label }),
    );
    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Register a Coworker"),
      React.createElement(
        Text,
        { dimColor: true },
        "Pick the runtime. Chat and Tasks land after it connects to one workspace.",
      ),
      React.createElement(SelectInput, {
        items,
        onSelect: adaptSelectHandler<string>((presetId) => {
          const preset = COWORKER_FRAMEWORK_PRESETS.find(
            (candidate) => candidate.id === presetId,
          );
          if (preset) setMessage(describeRegisterNextStep(preset));
        }),
        listen: !busy,
      }),
      navigationHint({ back: true }),
      message ? React.createElement(Text, null, message) : null,
    );
  }

  if (route === "signed-in" && screen !== "home" && screen !== "register") {
    return React.createElement(ResourceView, {
      resource: screen as ResourceKind,
      coreClient: resourceClient,
      onBack: () => {
        setScreen("home");
        setMessage("");
      },
      onNavigate: (resource) => {
        setScreen(resource);
        setMessage("");
      },
    });
  }

  if (route === "signed-in") {
    const items: SelectorItem<HomeAction>[] = [
      { value: "dashboard", label: "Dashboard" },
      { value: "agents", label: "Agents" },
      { value: "coworkers", label: "Coworkers" },
      { value: "tasks", label: "Tasks" },
      { value: "jobs", label: "Jobs" },
      { value: "account", label: "Account" },
      { value: "register", label: "Register a Coworker" },
      { value: "sign-out", label: "Sign out" },
    ];
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
      React.createElement(SelectInput, {
        items,
        onSelect: adaptSelectHandler<HomeAction>((action) => {
          if (action === "register") {
            setScreen("register");
            setMessage("");
            return;
          }
          if (action !== "sign-out") {
            setScreen(action);
            setMessage("");
            return;
          }
          activeManager.logout();
          setAuthState({
            authenticated: false,
            authMethod: null,
            expiresAt: null,
          });
          setScreen("auth-method");
          setMessage("Signed out.");
        }),
        listen: !busy,
      }),
      navigationHint(),
      message ? React.createElement(Text, null, message) : null,
    );
  }

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { bold: true }, "Sokosumi CLI"),
    React.createElement(Text, null, "Not signed in."),
    React.createElement(SelectInput, {
      items: [
        { value: "oauth", label: "Browser OAuth" },
        { value: "api-key", label: "User API key" },
      ] satisfies readonly SelectorItem<AuthMethod>[],
      onSelect: adaptSelectHandler<AuthMethod>((method) => {
        if (method === "oauth") {
          setScreen("oauth-target");
          return;
        }
        beginApiKeyLogin();
      }),
      listen: !busy,
    }),
    navigationHint(),
    message ? React.createElement(Text, null, message) : null,
  );
}

export async function renderStatusApp({
  render = defaultRender,
  authManager,
  coreClient,
  loginFn,
  readStdin,
  env = process.env,
  config = resolveCliConfig({ env }),
}: StatusAppOptions = {}): Promise<{ tui: true }> {
  const manager = authManager || getManagerForConfig(config, env);
  const { waitUntilExit } = render(
    React.createElement(StatusApp, {
      authManager: manager,
      coreClient,
      loginFn,
      readStdin,
      env,
      config,
    }),
  );
  await waitUntilExit();
  return { tui: true };
}
