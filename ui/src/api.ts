const BASE = "";

export interface FileContent {
  content: string;
  language: string;
}

export interface FolderFiles {
  name: string;
  root: string;
  files: string[];
}

export async function getFolders(): Promise<FolderFiles[]> {
  const res = await fetch(`${BASE}/files`);
  const data = await res.json();
  return data.folders;
}

export async function getFile(root: string, path: string): Promise<FileContent> {
  const res = await fetch(
    `${BASE}/file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`
  );
  return res.json();
}

export async function saveFile(root: string, path: string, content: string): Promise<void> {
  const res = await fetch(
    `${BASE}/file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }
  );
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
}
