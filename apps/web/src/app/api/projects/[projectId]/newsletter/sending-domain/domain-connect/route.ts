import { err } from "neverthrow";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { toActionResult } from "@/lib/actions/action-result";
import { getNewsletterSendingDomainConnect } from "@/lib/actions/newsletter/sending-domain";
import {
  CoreAuthUnavailableError,
  UnAuthenticatedError,
} from "@/lib/auth/errors";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// HTTP discovery bypasses the browser's server-action queue for DNS mutations.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const t = await getTranslations("App.Projects.Newsletter.SendingDomain");
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) {
    return NextResponse.json(
      toActionResult(err({ message: t("errors.domainRejected") })),
      { status: 422, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await getNewsletterSendingDomainConnect({ projectId });
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const status =
      error instanceof UnAuthenticatedError
        ? 401
        : error instanceof CoreAuthUnavailableError
          ? 503
          : 502;
    return NextResponse.json(
      toActionResult(err({ message: t("errors.generic") })),
      { status, headers: NO_STORE_HEADERS },
    );
  }
}
