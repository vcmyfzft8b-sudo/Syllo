import Link from "next/link";

import { BillingPortalButton } from "@/components/billing-portal-button";
import { EmojiIcon } from "@/components/emoji-icon";
import { ThemeSettings } from "@/components/theme-settings";
import { getViewerAppState } from "@/lib/billing";
import { requireUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";

function SettingsLinkCard(props: {
  href: string;
  icon: string;
  title: string;
  detail?: string;
}) {
  return (
    <Link href={props.href} className="dashboard-link-card settings-link-card">
      <span className="note-action-card-icon">
        <EmojiIcon symbol={props.icon} size="1.2rem" />
      </span>
      <span className="note-action-card-copy">
        <span className="note-action-card-label">{props.title}</span>
        {props.detail ? <span className="note-action-card-detail">{props.detail}</span> : null}
      </span>
      <EmojiIcon className="note-action-card-chevron" symbol="›" size="1.1rem" />
    </Link>
  );
}

function SettingsExternalCard(props: {
  href: string;
  icon: string;
  title: string;
  detail?: string;
}) {
  return (
    <a href={props.href} className="dashboard-link-card settings-link-card">
      <span className="note-action-card-icon">
        <EmojiIcon symbol={props.icon} size="1.2rem" />
      </span>
      <span className="note-action-card-copy">
        <span className="note-action-card-label">{props.title}</span>
        {props.detail ? <span className="note-action-card-detail">{props.detail}</span> : null}
      </span>
      <EmojiIcon className="note-action-card-chevron" symbol="›" size="1.1rem" />
    </a>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const appState = await getViewerAppState();
  const email = user.email ?? user.user_metadata.email ?? "Signed-in user";
  const subscription = appState?.subscription ?? null;

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
          <h2 className="dashboard-section-title">Subscription</h2>
        </div>

        <div className="dashboard-surface-card settings-account-card">
          <div className="min-w-0">
            <p className="dashboard-overline">Plan</p>
            <p className="settings-account-value">
              {subscription ? `${subscription.plan} (${subscription.status.replaceAll("_", " ")})` : "Not subscribed"}
            </p>
            <p className="ios-row-subtitle mt-1">
              {subscription?.current_period_end
                ? `Renews through ${new Date(subscription.current_period_end).toLocaleDateString()}`
                : "Users are sent to onboarding and billing before the main app opens."}
            </p>
          </div>

          {subscription ? (
            <BillingPortalButton />
          ) : (
            <Link href="/app/start" className="settings-inline-action">
              <EmojiIcon symbol="✨" size="0.95rem" />
              Choose plan
            </Link>
          )}
        </div>
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
              <EmojiIcon symbol="🚪" size="0.95rem" />
              Sign out
            </button>
          </form>
        </div>

        <div className="note-action-grid">
          <SettingsLinkCard
            href="/app/support/redeem-code"
            icon="🎟️"
            title="Redeem code"
          />
          <SettingsLinkCard
            href="/app/support/privacy-policy"
            icon="🔒"
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
            icon="📤"
            title="Share"
          />
          <SettingsLinkCard
            href="/app/support/feature-request"
            icon="💡"
            title="Suggest a feature"
          />
        </div>
      </section>
    </main>
  );
}
