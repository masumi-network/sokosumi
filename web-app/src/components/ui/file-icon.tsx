import { FileIcon as ReactFileIcon, defaultStyles } from "react-file-icon";

export interface FileTypeIconProps {
  extension: string;
}

export function FileTypeIcon({ extension }: FileTypeIconProps) {
  const style = (defaultStyles as Record<string, unknown>)[extension] ?? {};
  return <ReactFileIcon extension={extension} {...style} />;
}


