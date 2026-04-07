"use client";

import { Check, Loader2 } from "lucide-react";
import { startTransition, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { EmojiIcon } from "@/components/emoji-icon";
import type { BillingSubscriptionRow, ProfileRow } from "@/lib/database.types";

type BillingPlanCard = {
  id: "weekly" | "monthly" | "yearly";
  label: string;
  cadence: string;
  amount: number;
  displayAmount?: string;
  originalDisplayAmount?: string;
  discountNote?: string;
  billingNote?: string;
  annualizedAmount: number;
  blurb: string;
};

const AGE_OPTIONS = [
  { value: "under_16", label: "Manj kot 16" },
  { value: "16_18", label: "16-18" },
  { value: "19_22", label: "19-22" },
  { value: "23_29", label: "23-29" },
  { value: "30_plus", label: "30+" },
] as const;

const EDUCATION_OPTIONS = [
  { value: "high_school", label: "Srednja šola" },
  { value: "university", label: "Fakulteta" },
  { value: "masters", label: "Magisterij" },
  { value: "self_study", label: "Samostojno učenje" },
  { value: "other", label: "Drugo" },
] as const;

function CheckoutBanner({ state }: { state: string | null }) {
  if (state === "success") {
    return (
      <div className="app-start-banner success">
        <Check className="h-4 w-4" />
        Plačilo prejeto. Stripe trenutno zaključuje aktivacijo naročnine.
      </div>
    );
  }

  if (state === "cancelled") {
    return (
      <div className="app-start-banner">
        <EmojiIcon symbol="🧾" size="1rem" />
        Plačilo je bilo preklicano. Spodaj lahko ponovno izbereš paket.
      </div>
    );
  }

  return null;
}

export function OnboardingPaywall({
  profile,
  subscription,
  onboardingComplete,
  hasPaidAccess,
  hasTrialLectureAvailable,
  trialLectureId,
  trialChatMessagesRemaining,
  plans,
}: {
  profile: ProfileRow | null;
  subscription: BillingSubscriptionRow | null;
  onboardingComplete: boolean;
  hasPaidAccess: boolean;
  hasTrialLectureAvailable: boolean;
  trialLectureId: string | null;
  trialChatMessagesRemaining: number;
  plans: BillingPlanCard[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [savingProfile, setSavingProfile] = useState(false);
  const [isPersonalizing, setIsPersonalizing] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlanCard["id"] | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [form, setForm] = useState({
    ageRange: profile?.age_range ?? AGE_OPTIONS[2].value,
    educationLevel: profile?.education_level ?? EDUCATION_OPTIONS[1].value,
    currentAverageGrade: profile?.current_average_grade ?? "",
    targetGrade: profile?.target_grade ?? "",
    studyGoal: profile?.study_goal ?? "",
  });

  const onboardingSteps = [
    {
      overline: "Korak 1",
      title: "Koliko si star/a?",
      copy: "To uporabimo za prilagoditev tona, tempa in primerov tebi.",
      body: (
        <div className="app-start-choice-grid">
          {AGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`app-start-choice ${form.ageRange === option.value ? "selected" : ""}`}
              onClick={() => setForm((current) => ({ ...current, ageRange: option.value }))}
            >
              {option.label}
            </button>
          ))}
        </div>
      ),
    },
    {
      overline: "Korak 2",
      title: "Na kateri stopnji izobraževanja si?",
      copy: "To nam pomaga prilagoditi način razlage in intenzivnost učenja tebi.",
      body: (
        <div className="app-start-choice-grid">
          {EDUCATION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`app-start-choice ${form.educationLevel === option.value ? "selected" : ""}`}
              onClick={() => setForm((current) => ({ ...current, educationLevel: option.value }))}
            >
              {option.label}
            </button>
          ))}
        </div>
      ),
    },
    {
      overline: "Korak 3",
      title: "Kakšna je tvoja trenutna povprečna ocena?",
      copy: "Uporabi obliko ocenjevanja, ki ti je domača: povprečje, odstotki ali opisna lestvica.",
      body: (
        <label className="app-start-field">
          <span>Kakšna je tvoja trenutna povprečna ocena?</span>
          <input
            value={form.currentAverageGrade}
            onChange={(event) =>
              setForm((current) => ({ ...current, currentAverageGrade: event.target.value }))
            }
            placeholder="Primer: 7,8 / 10"
            maxLength={40}
          />
        </label>
      ),
    },
    {
      overline: "Korak 4",
      title: "Kakšno oceno želiš in kaj je tvoj cilj?",
      copy: "To uporabimo, da je aplikacija že od prvega dne usmerjena v rezultat, ki ga želiš.",
      body: (
        <div className="app-start-field-stack">
          <label className="app-start-field">
            <span>Kakšno oceno želiš?</span>
            <input
              value={form.targetGrade}
              onChange={(event) =>
                setForm((current) => ({ ...current, targetGrade: event.target.value }))
              }
              placeholder="Primer: 9 / 10"
              maxLength={40}
            />
          </label>

          <label className="app-start-field">
            <span>Kateri je tvoj glavni študijski cilj?</span>
            <textarea
              value={form.studyGoal}
              onChange={(event) =>
                setForm((current) => ({ ...current, studyGoal: event.target.value }))
              }
              placeholder="Primer: Ostati dosleden in ne zaostajati več z zapiski predavanj."
              rows={4}
              maxLength={240}
            />
          </label>
        </div>
      ),
    },
  ];

  async function submitOnboarding() {
    setSavingProfile(true);

    try {
      const response = await fetch("/api/profile/onboarding", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        throw new Error("Onboardinga ni bilo mogoče shraniti.");
      }

      setIsPersonalizing(true);
      await new Promise((resolve) => window.setTimeout(resolve, 1800));

      startTransition(() => {
        router.refresh();
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function startCheckout(plan: BillingPlanCard["id"]) {
    setCheckoutPlan(plan);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ plan }),
      });

      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Plačila ni bilo mogoče začeti.");
      }

      window.location.href = payload.url;
    } finally {
      setCheckoutPlan(null);
    }
  }

  async function openPortal() {
    setPortalLoading(true);

    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
      });
      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Portala za obračun ni bilo mogoče odpreti.");
      }

      window.location.href = payload.url;
    } finally {
      setPortalLoading(false);
    }
  }

  if (!onboardingComplete) {
    if (isPersonalizing) {
      return (
        <section className="app-start-panel app-start-panel-fullscreen app-start-panel-survey">
          <div className="app-start-wizard app-start-wizard-fullscreen app-start-wizard-survey app-start-personalizing">
            <div className="app-start-personalizing-orb" aria-hidden="true" />
            <p className="app-start-kicker">Prilagajamo tvojo aplikacijo</p>
            <h2>Nastavljamo jo po tvoji meri.</h2>
            <p>
              Aplikacijo prilagajamo tvoji starosti, ravni študija, trenutni oceni in cilju, da
              bo od začetka delovala osebno in uporabno.
            </p>
            <div className="app-start-personalizing-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </section>
      );
    }

    const currentStep = onboardingSteps[step];
    const isLastStep = step === onboardingSteps.length - 1;
    const canFinish =
      form.currentAverageGrade.trim().length > 0 &&
      form.targetGrade.trim().length > 0 &&
      form.studyGoal.trim().length > 0;

    return (
      <section className="app-start-panel app-start-panel-fullscreen app-start-panel-survey">
        <div className="app-start-wizard app-start-wizard-fullscreen app-start-wizard-survey">
          <div className="app-start-progress">
            {onboardingSteps.map((wizardStep, index) => (
              <div
                key={wizardStep.title}
                className={`app-start-progress-dot ${index === step ? "active" : ""} ${index < step ? "complete" : ""}`}
              />
            ))}
          </div>

          <div className="app-start-step-card">
            <p className="app-start-overline">{currentStep.overline}</p>
            <h2>{currentStep.title}</h2>
            <p>{currentStep.copy}</p>
            {currentStep.body}
          </div>

          <div className="app-start-actions">
            <button
              type="button"
              className="app-start-secondary-button"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0 || savingProfile}
            >
              Nazaj
            </button>

            {isLastStep ? (
              <button
                type="button"
                className="app-start-primary-button"
                onClick={submitOnboarding}
                disabled={!canFinish || savingProfile}
              >
                {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Zaključi nastavitev
              </button>
            ) : (
              <button
                type="button"
                className="app-start-primary-button"
                onClick={() => setStep((current) => Math.min(onboardingSteps.length - 1, current + 1))}
              >
                Nadaljuj
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  const showTrialIntro = onboardingComplete && !hasPaidAccess && hasTrialLectureAvailable;
  const trialConsumed = onboardingComplete && !hasPaidAccess && !hasTrialLectureAvailable;

  return (
    <section className="app-start-panel app-start-panel-paywall">
      {onboardingComplete ? (
        <div className="app-start-dismiss-row">
          <button
            type="button"
            className="app-start-close-button"
            onClick={() => router.push("/app")}
            aria-label="Zapri ponudbo naročnine"
          >
            <EmojiIcon symbol="✕" size="0.95rem" />
          </button>
        </div>
      ) : null}

      <CheckoutBanner state={searchParams.get("checkout")} />

      {showTrialIntro ? (
        <div className="app-start-banner">
          <EmojiIcon symbol="🎁" size="1rem" />
          1 brezplačen zapisek vključuje zapiske, kartice, kviz, preizkus znanja in 5 sporočil v klepetu.
        </div>
      ) : null}

      {trialConsumed ? (
        <div className="app-start-banner">
          <EmojiIcon symbol="⏳" size="1rem" />
          Tvoj brezplačni poskusni zapisek je že porabljen
          {trialLectureId ? `, za klepet pa ti je ostalo še ${trialChatMessagesRemaining} brezplačnih sporočil.` : "."}
        </div>
      ) : null}

      {showTrialIntro ? (
        <div className="app-start-subscription-status">
          <div>
            <p className="app-start-overline">Brezplačen preizkus</p>
            <h3>Nadaljuj v aplikacijo</h3>
            <p>Najprej preizkusi en zapisek. Če ti pomaga, potem nadgradi na plačljiv paket.</p>
          </div>

          <button
            type="button"
            className="app-start-primary-button"
            onClick={() => router.push("/app")}
          >
            Nadaljuj v aplikacijo
          </button>
        </div>
      ) : null}

      <div className="app-start-pricing-grid">
        {plans.map((plan) => {
          const activePlan = subscription?.plan === plan.id && hasPaidAccess;

          return (
            <article
              key={plan.id}
              className={`app-start-price-card ${plan.id === "monthly" ? "featured" : ""}`}
            >
              <div className="app-start-price-header">
                <div>
                  <p className="app-start-price-name">{plan.label}</p>
                  {plan.originalDisplayAmount ? (
                  <p className="app-start-price-original">Običajno €{plan.originalDisplayAmount}</p>
                  ) : null}
                  <h2>€{plan.displayAmount ?? plan.amount}</h2>
                  <p className="app-start-price-cadence">{plan.cadence}</p>
                  {plan.discountNote ? (
                    <p className="app-start-price-discount-note">{plan.discountNote}</p>
                  ) : null}
                  {plan.billingNote ? (
                    <p className="app-start-price-billing-note">{plan.billingNote}</p>
                  ) : null}
                </div>
                {plan.id === "monthly" ? <span className="app-start-badge">Privzeto</span> : null}
              </div>

              <p className="app-start-price-blurb">{plan.blurb}</p>
              <p className="app-start-price-footnote">Letni strošek: €{plan.annualizedAmount}</p>

              <button
                type="button"
                className="app-start-primary-button"
                onClick={() => startCheckout(plan.id)}
                disabled={checkoutPlan !== null || activePlan}
              >
                {checkoutPlan === plan.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {activePlan ? "Trenutni paket" : `Izberi ${plan.label.toLowerCase()}`}
              </button>
            </article>
          );
        })}
      </div>

      <p className="app-start-discount-note">
        Imaš kodo za popust? Vnesi jo v Stripe Checkout pred zaključkom plačila.
      </p>

      {subscription ? (
        <div className="app-start-subscription-status">
          <div>
            <p className="app-start-overline">Trenutno stanje naročnine</p>
            <h3>{subscription.status.replaceAll("_", " ")}</h3>
            <p>
              Paket {subscription.plan}
              {subscription.current_period_end
                ? ` do ${new Date(subscription.current_period_end).toLocaleDateString()}`
                : ""}
            </p>
          </div>

          <button
            type="button"
            className="app-start-secondary-button"
            onClick={openPortal}
            disabled={portalLoading}
          >
            {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Uredi naročnino
          </button>
        </div>
      ) : null}
    </section>
  );
}
