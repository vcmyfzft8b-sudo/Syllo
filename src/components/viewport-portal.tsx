"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function ViewportPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") {
    return <>{children}</>;
  }

  return createPortal(children, document.body);
}
