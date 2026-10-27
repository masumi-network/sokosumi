import { listChatStickers, uploadChatSticker } from "@sokosumi/core-client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

export async function getSavedChatStickers() {
  const response = await listChatStickers({
    client: getBrowserCoreClient(),
    throwOnError: true,
  });
  return response.data.data;
}

export async function saveChatSticker(file: File) {
  const response = await uploadChatSticker({
    client: getBrowserCoreClient(),
    body: { file },
    throwOnError: true,
  });
  return response.data.data;
}
