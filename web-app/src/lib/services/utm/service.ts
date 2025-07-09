import "server-only";

import { cookies } from "next/headers";

import { UTM_COOKIE_NAME, UTMData, utmDataSchema } from "@/lib/utils/utm";

export async function getUTMDataFromCookie(): Promise<UTMData | null> {
  const cookieStore = await cookies();
  const utmCookie = cookieStore.get(UTM_COOKIE_NAME)?.value;
  if (!utmCookie) {
    return null;
  }
  try {
    return utmDataSchema.parse(JSON.parse(utmCookie));
  } catch (error) {
    console.error("Failed to parse UTM cookie", error);
    return null;
  }
}
