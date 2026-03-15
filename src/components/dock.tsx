"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useRef, useState } from "react";

type DockItem = {
  icon: ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
};

export function Dock({
  items,
  panelHeight = 68,
  baseItemSize = 50,
  magnification = 70,
}: {
  items: DockItem[];
  panelHeight?: number;
  baseItemSize?: number;
  magnification?: number;
}) {
  const itemRefs = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);
  const [sizes, setSizes] = useState(() => items.map(() => baseItemSize));
  const defaultSizes = useMemo(
    () => items.map(() => baseItemSize),
    [baseItemSize, items],
  );

  function updateSizes(mousePosition: number) {
    const nextSizes = items.map((_, index) => {
      const item = itemRefs.current[index];

      if (!item) {
        return baseItemSize;
      }

      const rect = item.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const range = baseItemSize * 2;
      const distance = Math.abs(mousePosition - center);
      const influence = Math.max(0, 1 - distance / range);

      return baseItemSize + (magnification - baseItemSize) * influence;
    });

    setSizes(nextSizes);
  }

  return (
    <div className="nota-dock-shell">
      <div
        className="nota-dock-panel"
        style={{ minHeight: `${panelHeight}px` }}
        onMouseLeave={() => setSizes(defaultSizes)}
        onMouseMove={(event) => updateSizes(event.clientX)}
      >
        {items.map((item, index) => {
          const size = sizes[index] ?? baseItemSize;
          const sharedProps = {
            className: `nota-dock-item ${item.active ? "active" : ""}`,
            style: {
              width: `${size}px`,
              height: `${size}px`,
            },
            title: item.label,
          };

          return (
            <div key={item.label} className="nota-dock-item-wrap">
              {item.href ? (
                <Link
                  href={item.href}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  {...sharedProps}
                >
                  {item.icon}
                </Link>
              ) : (
                <button
                  type="button"
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  onClick={item.onClick}
                  {...sharedProps}
                >
                  {item.icon}
                </button>
              )}
              <span className="nota-dock-label">{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
