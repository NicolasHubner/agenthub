import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DirectoryPicker } from "./DirectoryPicker";
import * as ws from "./workspaces";

afterEach(() => vi.restoreAllMocks());

describe("DirectoryPicker", () => {
  it("lists entries and confirms the current path", async () => {
    vi.spyOn(ws, "browse").mockResolvedValue({
      path: "/home/me",
      parent: "/home",
      entries: [{ name: "projects", dir: true }],
    });
    const onConfirm = vi.fn();
    render(<DirectoryPicker title="New workspace" onCancel={() => {}} onConfirm={onConfirm} />);
    await waitFor(() => screen.getByText("projects"));
    expect(screen.getByText("/home/me")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Select this folder/i));
    expect(onConfirm).toHaveBeenCalledWith("/home/me");
  });

  it("descends into a clicked directory", async () => {
    vi.spyOn(ws, "browse")
      .mockResolvedValueOnce({ path: "/home/me", parent: "/home", entries: [{ name: "projects", dir: true }] })
      .mockResolvedValueOnce({ path: "/home/me/projects", parent: "/home/me", entries: [] });
    render(<DirectoryPicker title="x" onCancel={() => {}} onConfirm={() => {}} />);
    await waitFor(() => screen.getByText("projects"));
    fireEvent.click(screen.getByText("projects"));
    await waitFor(() => screen.getByText("/home/me/projects"));
  });
});
