import Link from "next/link";
import { ChevronRight, CircleHelp, Sparkles } from "lucide-react";

import { HELP_SECTIONS } from "@/lib/help-center";

export default function SupportPage() {
  return (
    <main className="space-y-6">
      <div className="space-y-4 mb-8">
        <div className="ios-title-block mb-2">
          <p className="ios-section-label tracking-wider uppercase text-xs font-bold text-[var(--secondary-label)] mb-1">Help</p>
          <h1 className="ios-large-title">Help without the extra searching.</h1>
          <p className="ios-subtitle mt-2">
            Common questions, quick guides, and core explanations are all in one
            place.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-8">
          <div className="p-5 rounded-[18px] bg-[var(--surface-solid)] border border-[var(--separator)]">
            <div className="flex items-center gap-2">
              <CircleHelp className="h-4 w-4 text-[var(--tint)]" />
              <p className="ios-section-label text-xs font-bold tracking-wider uppercase">Guides</p>
            </div>
            <p className="ios-row-subtitle mt-3">
              From signing in to creating notes and solving common issues.
            </p>
          </div>

          <div className="p-5 rounded-[18px] bg-[var(--surface-solid)] border border-[var(--separator)]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--tint)]" />
              <p className="ios-section-label text-xs font-bold tracking-wider uppercase">Simple flow</p>
            </div>
            <p className="ios-row-subtitle mt-3">
              Explanations stay short and focused on the next useful step, not long manuals.
            </p>
          </div>
        </div>
      </div>

      {HELP_SECTIONS.map((section) => (
        <section key={section.title} className="ios-section">
          <p className="ios-section-label">{section.title}</p>
          <div className="ios-group">
            {section.items.map((item) => (
              <Link
                key={item.slug}
                href={`/app/support/${item.slug}`}
                className="ios-row ios-pressable"
              >
                <div className="min-w-0 flex-1">
                  <p className="ios-row-title">{item.title}</p>
                </div>
                <ChevronRight className="ios-chevron h-4 w-4" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
