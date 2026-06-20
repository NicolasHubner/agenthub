import { useEffect, useState } from "react";
import { browse, type BrowseResult } from "./workspaces";

type Props = {
  title: string;
  onCancel: () => void;
  onConfirm: (dir: string) => void;
};

export function DirectoryPicker({ title, onCancel, onConfirm }: Props) {
  const [view, setView] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function go(path: string) {
    browse(path)
      .then((v) => {
        setView(v);
        setError(null);
      })
      .catch(() => setError("Cannot open this folder"));
  }

  useEffect(() => {
    go(""); // start at home
  }, []);

  return (
    <div className="picker-backdrop" onClick={onCancel}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>{title}</strong>
          <button type="button" onClick={onCancel} aria-label="Cancel">✕</button>
        </div>
        <div className="picker-path">{view?.path ?? "…"}</div>
        <ul className="picker-list">
          {view?.parent != null && (
            <li>
              <button type="button" className="picker-up" onClick={() => go(view.parent!)}>
                <span className="tree-icon">⬆</span> ..
              </button>
            </li>
          )}
          {view?.entries.map((e) => (
            <li key={e.name}>
              <button type="button" onClick={() => go(`${view.path}/${e.name}`)}>
                <span className="tree-icon">📁</span> {e.name}
              </button>
            </li>
          ))}
        </ul>
        {error && <div className="picker-error">{error}</div>}
        <div className="picker-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="picker-confirm"
            disabled={!view}
            onClick={() => view && onConfirm(view.path)}
          >
            Select this folder
          </button>
        </div>
      </div>
    </div>
  );
}
