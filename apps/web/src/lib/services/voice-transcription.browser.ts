import { transcribeVoice } from "@sokosumi/core-client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

/** What was said in a recording; empty when nothing was. */
export async function transcribeVoiceRecording(file: Blob): Promise<string> {
  const response = await transcribeVoice({
    client: getBrowserCoreClient(),
    body: file,
    headers: { "Content-Type": file.type.split(";")[0] ?? "" },
    throwOnError: true,
  });
  return response.data.data.text;
}
