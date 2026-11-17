import { z } from "zod";
import { seoFilterQuerySchema } from "@/app/seo/seo-query";
import { readSeoResponse } from "@/lib/seo/read-response";
import { seoChatServiceNoRedirect } from "@/lib/services/seo-chat.service";

const inputSchema = z
  .object({
    question: z.string(),
    idempotencyKey: z.string(),
    scope: seoFilterQuerySchema.optional(),
  })
  .strict();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  return readSeoResponse(request, { kind: "audit", id: auditId }, () =>
    seoChatServiceNoRedirect.list(auditId),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  return readSeoResponse(request, { kind: "audit", id: auditId }, async () =>
    seoChatServiceNoRedirect.send(
      auditId,
      inputSchema.parse(await request.json()),
    ),
  );
}
