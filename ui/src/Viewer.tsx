import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import type { FileContent } from "./api";

export function Viewer({ file }: { file: FileContent | null }) {
  if (!file) return <div className="viewer empty">Select a file to view it.</div>;

  if (file.kind === "markdown") {
    return (
      <div className="viewer markdown">
        <Markdown remarkPlugins={[remarkGfm]}>{file.content}</Markdown>
      </div>
    );
  }

  if (file.kind === "code") {
    return (
      <div className="viewer code">
        <SyntaxHighlighter language={file.ext} wrapLongLines>
          {file.content}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <div className="viewer text">
      <pre>{file.content}</pre>
    </div>
  );
}
