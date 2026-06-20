export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: { name: string; dir: true }[];
}

export async function browse(path = ""): Promise<BrowseResult> {
  const res = await fetch(`/browse?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`/browse ${res.status}`);
  return (await res.json()) as BrowseResult;
}

export interface WorkspaceEntry {
  id: string;
  name: string;
  folders: string[];
}

export async function listWorkspaces(): Promise<{ active: string; workspaces: WorkspaceEntry[] }> {
  const res = await fetch("/workspaces");
  if (!res.ok) throw new Error(`/workspaces ${res.status}`);
  return res.json();
}

export async function createWorkspace(folder: string, name?: string): Promise<WorkspaceEntry> {
  const res = await fetch("/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { folder, name } : { folder }),
  });
  if (!res.ok) throw new Error(`create workspace ${res.status}`);
  return res.json();
}

export async function switchWorkspace(id: string): Promise<void> {
  const res = await fetch("/workspaces/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(`switch workspace ${res.status}`);
}

export async function connectFolder(id: string, dir: string): Promise<void> {
  const res = await fetch(`/workspaces/${id}/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir }),
  });
  if (!res.ok) throw new Error(`connect folder ${res.status}`);
}

export async function removeWorkspace(id: string): Promise<void> {
  const res = await fetch(`/workspaces/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`remove workspace ${res.status}`);
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  const res = await fetch(`/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`rename workspace ${res.status}`);
}
