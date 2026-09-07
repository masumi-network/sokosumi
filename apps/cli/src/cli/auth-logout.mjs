import { getAuthManager } from "../auth/auth-manager.mjs";

export async function runAuthLogout({
  authManager = getAuthManager(),
  stdout = process.stdout,
  json = false,
} = {}) {
  authManager.logout();
  const result = { authenticated: false };
  if (json) {
    stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    stdout.write("Signed out.\n");
  }
  return result;
}
