import Link from "next/link";

import { EmojiIcon } from "@/components/emoji-icon";
import { HELP_SECTIONS } from "@/lib/help-center";

export default function SupportPage() {
  return (
    <main className="home-dashboard pb-8">
      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <div>
            <h1 className="dashboard-page-title">Pomoč</h1>
          </div>
        </div>
      </section>

      {HELP_SECTIONS.map((section) => (
        <section key={section.title} className="dashboard-section">
          <div className="dashboard-section-heading">
            <h2 className="dashboard-section-title">{section.title}</h2>
          </div>

          <div className="dashboard-note-list">
            {section.items.map((item) => (
              <Link
                key={item.slug}
                href={`/app/support/${item.slug}`}
                className="dashboard-link-card"
              >
                <p className="dashboard-link-card-title">{item.title}</p>
                <EmojiIcon className="ios-chevron" symbol="›" size="1.1rem" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
