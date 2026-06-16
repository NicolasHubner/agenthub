import { describe, it, expect, vi, afterEach } from "vitest";
import { getFiles, getFile } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("api", () => {
  it("getFiles returns the files array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ files: ["a.md", "b.rs"] }))),
    );
    expect(await getFiles()).toEqual(["a.md", "b.rs"]);
  });

  it("getFile fetches by encoded path and returns content", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ path: "a.md", content: "# hi", kind: "markdown", ext: "md" }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const f = await getFile("docs/a b.md");
    expect(f.content).toBe("# hi");
    expect(fetchMock).toHaveBeenCalledWith("/file?path=docs%2Fa%20b.md");
  });
});
