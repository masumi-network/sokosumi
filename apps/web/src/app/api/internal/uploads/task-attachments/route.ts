import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/utils";
import { uploadFileForUser } from "@/lib/blob/utils";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File exceeds maximum allowed size" },
      { status: 400 },
    );
  }

  try {
    const uploaded = await uploadFileForUser(session.user.id, file);
    return NextResponse.json({
      url: uploaded.url,
      name: file.name,
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
