import { describe, it, expect, vi, afterEach } from "vitest";
import { listWorkspaces, createWorkspace, switchWorkspace, connectFolder, renameWorkspace } from "./workspaces";

afterEach(() => vi.restoreAllMocks());

describe("workspaces client", () => {
  it("listWorkspaces returns active + list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ active: "ws-01", workspaces: [{ id: "ws-01", name: "Workspace 01", folders: ["/r"] }] }),
    })) as unknown as typeof fetch);
    const { active, workspaces } = await listWorkspaces();
    expect(active).toBe("ws-01");
    expect(workspaces[0].folders).toEqual(["/r"]);
  });

  it("createWorkspace POSTs folder + optional name", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: "ws-02", name: "x", folders: ["/d"] }) }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await createWorkspace("/d", "x");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const [url, opts] = calls[0];
    expect(url).toBe("/workspaces");
    expect(JSON.parse(opts.body as string)).toEqual({ folder: "/d", name: "x" });
  });

  it("connectFolder POSTs to the folders route", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await connectFolder("ws-01", "/d");
    const calls = fetchMock.mock.calls as unknown as [string][];
    expect(calls[0][0]).toBe("/workspaces/ws-01/folders");
  });

  it("renameWorkspace PATCHes the workspace name", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    await renameWorkspace("ws-01", "New name");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const [url, opts] = calls[0];
    expect(url).toBe("/workspaces/ws-01");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "New name" });
  });
});
