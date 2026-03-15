import Link from "next/link";
import { Bell, ChevronRight, Lock, Power, Send, Ticket } from "lucide-react";

import { ThemeSettings } from "@/components/theme-settings";
import { requireUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";

function SettingsRow(props: {
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
}) {
  const content = (
    <div className="ios-row ios-pressable">
      <div className="ios-row-icon">
        <props.icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="ios-row-title">{props.title}</p>
        {props.subtitle ? <p className="ios-row-subtitle">{props.subtitle}</p> : null}
      </div>
      {props.trailing ?? <ChevronRight className="ios-chevron h-4 w-4" />}
    </div>
  );

  if (props.href) {
    return <Link href={props.href}>{content}</Link>;
  }

  return content;
}

export default async function SettingsPage() {
  const user = await requireUser();
  const email = user.email ?? user.user_metadata.email ?? "Signed-in user";

  return (
    <main className="space-y-6">
      <div className="space-y-4 mb-8">
        <div className="ios-title-block mb-2">
          <p className="ios-section-label tracking-wider uppercase text-xs font-bold text-[var(--secondary-label)] mb-1">Settings</p>
          <h1 className="ios-large-title">Settings and account.</h1>
          <p className="ios-subtitle mt-2">
            Appearance, account, and support stay together in one calm screen.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-8">
          <div className="p-5 rounded-[18px] bg-[var(--surface-solid)] border border-[var(--separator)]">
            <p className="ios-section-label text-xs font-bold tracking-wider uppercase">Signed-in account</p>
            <p className="text-[1.05rem] font-medium mt-2">{email}</p>
            <p className="ios-row-subtitle mt-1">Active session on this device.</p>
          </div>

          <div className="p-5 rounded-[18px] bg-[var(--surface-solid)] border border-[var(--separator)]">
            <p className="ios-section-label text-xs font-bold tracking-wider uppercase">Support</p>
            <p className="text-[1.05rem] font-medium mt-2">Everything important in one place</p>
            <p className="ios-row-subtitle mt-1">
              Change the theme, share the app, or open help articles quickly.
            </p>
          </div>
        </div>
      </div>

      <section className="ios-section">
        <p className="ios-section-label">Appearance</p>
        <div className="ios-group">
          <ThemeSettings />
        </div>
      </section>

      <section className="ios-section">
        <p className="ios-section-label">Account</p>
        <div className="ios-group">
          <SettingsRow
            href="/app/support/redeem-code"
            icon={Ticket}
            title="Redeem code"
            subtitle="Add a promo or access code."
          />
          <SettingsRow
            href="/app/support/privacy-policy"
            icon={Lock}
            title="Privacy policy"
            subtitle="How your content is handled."
          />
          <div className="ios-row">
            <div className="ios-row-icon">
              <Power className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="ios-row-title">Sign out</p>
              <p className="ios-row-subtitle">{email}</p>
            </div>
            <form action="/auth/logout" method="post">
              <button type="submit" className="ios-text-button">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="ios-section">
        <p className="ios-section-label">Support</p>
        <div className="ios-group">
          <SettingsRow
            href={`mailto:?subject=${encodeURIComponent(`Try ${BRAND_NAME}`)}&body=${encodeURIComponent(`I am using ${BRAND_NAME} for lecture notes and thought it might be useful for you too.`)}`}
            icon={Send}
            title="Share the app"
            subtitle="Send a recommendation by email."
          />
          <SettingsRow
            href="/app/support/feature-request"
            icon={Bell}
            title="Suggest an improvement"
            subtitle="Send an idea for the next version."
          />
        </div>
      </section>
    </main>
  );
}
