import React from "react";

interface PDFViewerProps {
  src: string;
  title?: string;
  inline?: boolean;
}

export function PDFViewer({ src, title, inline }: PDFViewerProps) {
  return (
    <iframe
      className={inline ? "pdf-viewer-inline" : "pdf-viewer-fullpage"}
      src={src}
      title={title ?? "PDF viewer"}
    />
  );
}
