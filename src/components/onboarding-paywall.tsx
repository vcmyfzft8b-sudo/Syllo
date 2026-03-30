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
  annualizedAmount: number;
  blurb: string;
};

const AGE_OPTIONS = [
  { value: "under_16", label: "Under 16" },
  { value: "16_18", label: "16-18" },
  { value: "19_22", label: "19-22" },
  { value: "23_29", label: "23-29" },
  { value: "30_plus", label: "30+" },
] as const;

const EDUCATION_OPTIONS = [
  { value: "high_school", label: "High school" },
  { value: "university", label: "University" },
  { value: "masters", label: "Master's" },
  { value: "self_study", label: "Self-study" },
  { value: "other", label: "Other" },
] as const;

function CheckoutBanner({ state }: { state: string | null }) {
  if (state === "success") {
    return (
      <div className="app-start-banner success">
        <Check className="h-4 w-4" />
        Payment received. Stripe is finalizing the subscription now.
      </div>
    );
  }

  if (state === "cancelled") {
    return (
      <div className="app-start-banner">
        <EmojiIcon symbol="🧾" size="1rem" />
        Checkout was cancelled. You can pick a plan again below.
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
  plans,
}: {
  profile: ProfileRow | null;
  subscription: BillingSubscriptionRow | null;
  onboardingComplete: boolean;
  hasPaidAccess: boolean;
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
      overline: "Step 1",
      title: "How old are you?",
      copy: "We use this to adjust the tone, pacing, and examples to you.",
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
      overline: "Step 2",
      title: "What level of student are you?",
      copy: "This helps us match the explanation style and study intensity to you.",
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
      overline: "Step 3",
      title: "What is your current average grade?",
      copy: "Use the grading format you already think in: GPA, percentage, or a verbal scale.",
      body: (
        <label className="app-start-field">
          <span>What is your current average grade?</span>
          <input
            value={form.currentAverageGrade}
            onChange={(event) =>
              setForm((current) => ({ ...current, currentAverageGrade: event.target.value }))
            }
            placeholder="Example: 7.8 / 10"
            maxLength={40}
          />
        </label>
      ),
    },
    {
      overline: "Step 4",
      title: "What grade do you want, and what is your goal?",
      copy: "We use this to keep the app focused on the result you want from day one.",
      body: (
        <div className="app-start-field-stack">
          <label className="app-start-field">
            <span>What grade do you want?</span>
            <input
              value={form.targetGrade}
              onChange={(event) =>
                setForm((current) => ({ ...current, targetGrade: event.target.value }))
              }
              placeholder="Example: 9 / 10"
              maxLength={40}
            />
          </label>

          <label className="app-start-field">
            <span>What is your main study goal?</span>
            <textarea
              value={form.studyGoal}
              onChange={(event) =>
                setForm((current) => ({ ...current, studyGoal: event.target.value }))
              }
              placeholder="Example: Stay consistent and stop falling behind on lecture notes."
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
        throw new Error("Could not save onboarding.");
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
        throw new Error(payload.error ?? "Could not start checkout.");
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
        throw new Error(payload.error ?? "Could not open billing portal.");
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
            <p className="app-start-kicker">Customizing your app</p>
            <h2>Building your setup around you.</h2>
            <p>
              We&apos;re tuning the app to your age, study level, current grade, and goal so it
              feels personal from the start.
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
              Back
            </button>

            {isLastStep ? (
              <button
                type="button"
                className="app-start-primary-button"
                onClick={submitOnboarding}
                disabled={!canFinish || savingProfile}
              >
                {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Finish setup
              </button>
            ) : (
              <button
                type="button"
                className="app-start-primary-button"
                onClick={() => setStep((current) => Math.min(onboardingSteps.length - 1, current + 1))}
              >
                Continue
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="app-start-panel app-start-panel-paywall">
      {onboardingComplete ? (
        <div className="app-start-dismiss-row">
          <button
            type="button"
            className="app-start-close-button"
            onClick={() => router.push("/app")}
            aria-label="Close paywall"
          >
            <EmojiIcon symbol="✕" size="0.95rem" />
          </button>
        </div>
      ) : null}

      <CheckoutBanner state={searchParams.get("checkout")} />

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
                  <h2>€{plan.amount}</h2>
                  <p className="app-start-price-cadence">{plan.cadence}</p>
                </div>
                {plan.id === "monthly" ? <span className="app-start-badge">Default</span> : null}
              </div>

              <p className="app-start-price-blurb">{plan.blurb}</p>
              <p className="app-start-price-footnote">Effective yearly spend: €{plan.annualizedAmount}</p>

              <button
                type="button"
                className="app-start-primary-button"
                onClick={() => startCheckout(plan.id)}
                disabled={checkoutPlan !== null || activePlan}
              >
                {checkoutPlan === plan.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {activePlan ? "Current plan" : `Choose ${plan.label.toLowerCase()}`}
              </button>
            </article>
          );
        })}
      </div>

      <p className="app-start-discount-note">
        Have a discount code? Enter it in Stripe Checkout before completing payment.
      </p>

      {subscription ? (
        <div className="app-start-subscription-status">
          <div>
            <p className="app-start-overline">Current billing state</p>
            <h3>{subscription.status.replaceAll("_", " ")}</h3>
            <p>
              {subscription.plan} plan
              {subscription.current_period_end
                ? ` until ${new Date(subscription.current_period_end).toLocaleDateString()}`
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
            Manage billing
          </button>
        </div>
      ) : null}
    </section>
  );
}
