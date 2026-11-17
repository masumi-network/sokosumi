import { randomBytes } from "node:crypto";

// A throwaway inbox on the public mail.tm API, so a run can sign up a new
// user and read the emailed code. Nothing is stored: the password lives only
// for the run.
const API = "https://api.mail.tm";

interface Message {
  id: string;
}

async function call<T>(path: string, init: RequestInit = {}, token?: string) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(API + path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    // mail.tm rate-limits bursts; wait and try again.
    if (response.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      throw new Error(`mail.tm ${path}: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}

export interface Mailbox {
  address: string;
  /**
   * Waits for the next 6-digit code that arrives after the last one read, in a
   * message whose subject matches `subject` (other messages are skipped).
   */
  nextCode(timeoutMs?: number, subject?: RegExp): Promise<string>;
}

export async function createMailbox(): Promise<Mailbox> {
  const domains = await call<{
    "hydra:member": { domain: string; isActive: boolean; isPrivate: boolean }[];
  }>("/domains");
  const domain = domains["hydra:member"].find(
    (d) => d.isActive && !d.isPrivate,
  )?.domain;
  if (!domain) throw new Error("mail.tm has no active public domain");

  // mail.tm refuses some words in a username ("phone", "desktop"), so the
  // name carries no label, only random hex.
  const address = `soko-e2e-${randomBytes(6).toString("hex")}@${domain}`;
  const password = randomBytes(18).toString("base64url");
  const body = JSON.stringify({ address, password });
  await call("/accounts", { method: "POST", body });
  const { token } = await call<{ token: string }>("/token", {
    method: "POST",
    body,
  });
  const seen = new Set<string>();

  return {
    address,
    async nextCode(timeoutMs = 90_000, subject = /./) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const list = await call<{ "hydra:member": Message[] }>(
          "/messages",
          {},
          token,
        );
        for (const { id } of list["hydra:member"]) {
          if (seen.has(id)) continue;
          seen.add(id);
          const full = await call<{
            subject?: string;
            text?: string;
            html?: string[];
          }>(`/messages/${id}`, {}, token);
          // An invitation's HTML holds colour codes that look like codes.
          if (!subject.test(full.subject ?? "")) continue;
          const text = [full.subject, full.text, ...(full.html ?? [])].join(
            "\n",
          );
          const code = text
            .replace(/<[^>]+>/g, " ")
            .match(/(?<!\d)\d{6}(?!\d)/);
          if (code) return code[0];
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      throw new Error(`no code reached ${address} in ${timeoutMs} ms`);
    },
  };
}
