export type FileKind = "markdown" | "code" | "text";

export interface FileContent {
  path: string;
  content: string;
  kind: FileKind;
  ext: string;
}

export async function getFiles(): Promise<string[]> {
  const res = await fetch("/files");
  if (!res.ok) throw new Error(`/files ${res.status}`);
  const data = (await res.json()) as { files: string[] };
  return data.files;
}

export async function getFile(path: string): Promise<FileContent> {
  const res = await fetch(`/file?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`/file ${res.status}`);
  return (await res.json()) as FileContent;
}
