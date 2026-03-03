export interface AuthRedirectSearchParams {
  [key: string]: string | string[] | undefined;
}

export async function getRedirectQueryString(
  searchParams: Promise<AuthRedirectSearchParams>,
): Promise<string> {
  const params = await searchParams;
  const preservedSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        preservedSearchParams.append(key, item);
      }
      continue;
    }

    if (value) {
      preservedSearchParams.set(key, value);
    }
  }

  return preservedSearchParams.toString();
}
