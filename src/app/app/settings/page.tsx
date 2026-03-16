import Link from "next/link";
import { Bell, ChevronRight, Lock, Power, Send, Ticket } from "lucide-react";

import { ThemeSettings } from "@/components/theme-settings";
import { requireUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";

function SettingsLinkCard(props: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail?: string;
}) {
  return (
    <Link href={props.href} className="note-action-card compact-link-card">
      <span className="note-action-card-icon">
        <props.icon className="h-5 w-5" />
      </span>
      <span className="note-action-card-copy">
        <span className="note-action-card-label">{props.title}</span>
        {props.detail ? <span className="note-action-card-detail">{props.detail}</span> : null}
      </span>
      <ChevronRight className="note-action-card-chevron h-4 w-4" />
    </Link>
  );
}

function SettingsExternalCard(props: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail?: string;
}) {
  return (
    <a href={props.href} className="note-action-card compact-link-card">
      <span className="note-action-card-icon">
        <props.icon className="h-5 w-5" />
      </span>
      <span className="note-action-card-copy">
        <span className="note-action-card-label">{props.title}</span>
        {props.detail ? <span className="note-action-card-detail">{props.detail}</span> : null}
      </span>
      <ChevronRight className="note-action-card-chevron h-4 w-4" />
    </a>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const email = user.email ?? user.user_metadata.email ?? "Signed-in user";

  return (
    <main className="home-dashboard pb-8">
      <section className="dashboard-section">
        <div>
          <h1 className="dashboard-page-title">Settings</h1>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">Theme</h2>
        </div>
        <ThemeSettings />
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">Account</h2>
        </div>

        <div className="dashboard-surface-card settings-account-card">
          <div className="min-w-0">
            <p className="dashboard-overline">Signed in</p>
            <p className="settings-account-value">{email}</p>
          </div>

          <form action="/auth/logout" method="post">
            <button type="submit" className="settings-inline-action">
              <Power className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>

        <div className="note-action-grid">
          <SettingsLinkCard
            href="/app/support/redeem-code"
            icon={Ticket}
            title="Redeem code"
          />
          <SettingsLinkCard
            href="/app/support/privacy-policy"
            icon={Lock}
            title="Privacy"
          />
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <h2 className="dashboard-section-title">Help</h2>
        </div>

        <div className="note-action-grid">
          <SettingsExternalCard
            href={`mailto:?subject=${encodeURIComponent(`Try ${BRAND_NAME}`)}&body=${encodeURIComponent(`I am using ${BRAND_NAME} for lecture notes and thought it might be useful for you too.`)}`}
            icon={Send}
            title="Share"
          />
          <SettingsLinkCard
            href="/app/support/feature-request"
            icon={Bell}
            title="Suggest a feature"
          />
        </div>
      </section>
    </main>
  );
}
