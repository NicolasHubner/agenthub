import { describe, it, expect, vi, afterEach } from "vitest";
import { getFolders, getFile, saveFile } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("api", () => {
  it("getFolders calls /files and returns data.folders", async () => {
    const folders = [{ name: "repo", root: "/r", files: ["a.ts"] }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ folders }))),
    );
    const result = await getFolders();
    expect(result).toEqual(folders);
    expect(result[0].root).toBe("/r");
    expect(result[0].files).toEqual(["a.ts"]);
  });

  it("getFile fetches with root and encoded path", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: "# hi", language: "markdown" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const f = await getFile("/r", "docs/a b.md");
    expect(f.content).toBe("# hi");
    expect(f.language).toBe("markdown");
    const [url] = (fetchMock.mock.calls as unknown as [string, RequestInit?][])[0];
    expect(url).toContain("root=%2Fr");
    expect(url).toContain("path=docs%2Fa%20b.md");
  });

  it("getFile throws on error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    await expect(getFile("/root", "a.md")).rejects.toThrow("403");
  });

  it("saveFile PUTs with correct body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await saveFile("/r", "a.ts", "hello");
    const [url, opts] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toContain("/file?root=%2Fr&path=a.ts");
    expect(opts.method).toBe("PUT");
    expect(opts.body).toBe(JSON.stringify({ content: "hello" }));
  });

  it("saveFile throws on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    await expect(saveFile("/r", "a.ts", "x")).rejects.toThrow("Save failed: 500");
  });
});
