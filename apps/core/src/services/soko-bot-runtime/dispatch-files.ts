import {
  sokoBotDeleteFileInputSchema,
  sokoBotGenerateVoiceoverInputSchema,
  sokoBotInstallSkillInputSchema,
  sokoBotListFilesInputSchema,
  sokoBotListSkillsInputSchema,
  sokoBotMoveFileInputSchema,
  sokoBotReadFileInputSchema,
  sokoBotRemoveSkillInputSchema,
  sokoBotUploadFileInputSchema,
} from "@sokosumi/soko-bot";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";

export async function dispatchFilesTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "list_files": {
      const parsed = sokoBotListFilesInputSchema.parse(input.input);
      return runtime.listFiles(authorized, parsed);
    }

    case "upload_file": {
      const parsed = sokoBotUploadFileInputSchema.parse(input.input);
      return runtime.uploadFile(authorized, parsed);
    }

    case "generate_voiceover":
      return runtime.generateVoiceover(
        authorized,
        sokoBotGenerateVoiceoverInputSchema.parse(input.input),
      );

    case "move_file":
      return runtime.moveFile(
        authorized,
        sokoBotMoveFileInputSchema.parse(input.input),
        input.toolCallId,
      );

    case "delete_file":
      return runtime.deleteFile(
        authorized,
        sokoBotDeleteFileInputSchema.parse(input.input),
        input.toolCallId,
      );

    case "list_skills":
      return runtime.listSkills(
        authorized,
        sokoBotListSkillsInputSchema.parse(input.input),
      );

    case "install_skill":
      return runtime.installSkill(
        authorized,
        sokoBotInstallSkillInputSchema.parse(input.input),
        input.toolCallId,
      );

    case "remove_skill":
      return runtime.removeSkill(
        authorized,
        sokoBotRemoveSkillInputSchema.parse(input.input),
        input.toolCallId,
      );

    case "generate_image":
      return runtime.generateImage(authorized, input.input, input.toolCallId);

    case "get_image":
      return runtime.getStudioJob(authorized, input.input);

    case "generate_video":
      return runtime.generateVideo(authorized, input.input, input.toolCallId);

    case "get_video":
      return runtime.getStudioJob(authorized, input.input);

    case "read_file":
      return runtime.readFile(
        authorized,
        sokoBotReadFileInputSchema.parse(input.input),
      );
  }
}
