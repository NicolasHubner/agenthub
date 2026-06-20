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
