"use client";

import type { CSSProperties } from "react";

export function Folder({
  color = "#8294DA",
  size = 1,
  className = "",
  open,
}: {
  color?: string;
  size?: number;
  className?: string;
  open: boolean;
}) {
  const folderStyle = {
    "--folder-color": color,
    "--folder-back-color": "#6B7DCA",
    "--paper-1": "#FFFFFF",
    "--paper-2": "#FFFFFF",
    "--paper-3": "#FFFFFF",
  } as CSSProperties;

  return (
    <div style={{ transform: `scale(${size})` }} className={className}>
      <div className={`folder ${open ? "open" : ""}`.trim()} style={folderStyle}>
        <div className="folder__back">
          <div className="paper paper-1" />
          <div className="paper paper-2" />
          <div className="paper paper-3" />
          <div className="folder__front" />
          <div className="folder__front right" />
        </div>
      </div>
    </div>
  );
}
