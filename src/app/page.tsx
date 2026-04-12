import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { LandingLoadingLink } from "@/components/landing-loading-link";
import { LandingStoryPreview } from "@/components/landing-story-preview";
import { getOptionalUser } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";
import { hasPublicSupabaseEnv } from "@/lib/public-env";

const WORKFLOW_STEPS = [
  {
    icon: "🎙️",
    title: "1. Posnemi ali naloži",
    detail: "Predavanja, PDF-je, dokumente, povezave in besedilo.",
  },
  {
    icon: "📝",
    title: "2. Dobi zapiske",
    detail: "Urejeni zapiski in prepis so pripravljeni v istem prostoru.",
  },
  {
    icon: "🧠",
    title: "3. Ponavljaj snov",
    detail: "Flashcardi, kvizi, testi in AI chat z zapiski.",
  },
] as const;

const STUDY_EXAMPLES = [
  {
    label: "Flashcard",
    title: "Kaj je aktivni transport?",
    detail: "Premik snovi skozi membrano proti koncentracijskemu gradientu, zato porabi energijo.",
    meta: "Pokaži odgovor",
  },
  {
    label: "Kviz",
    title: "Encimi najpogosteje delujejo kot ...",
    detail: "Biološki katalizatorji, ki znižajo aktivacijsko energijo reakcije.",
    meta: "Pravilno",
  },
  {
    label: "Test",
    title: "Primerjaj mitozo in mejozo.",
    detail: "Odgovor naj razloži število delitev, nastale celice in genetsko raznolikost.",
    meta: "Vaja za izpit",
  },
  {
    label: "Klepet",
    title: "Zakaj je to pomembno za izpit?",
    detail: "Ker se isti pojmi pogosto pojavijo v nalogah razlage, primerjave in uporabe.",
    meta: "Vprašaj gradivo",
  },
] as const;

const FEATURE_CARDS = [
  {
    icon: "🎙️",
    title: "Posnemi ali naloži",
    detail: "Predavanja, PDF-je, dokumente, povezave in prilepljeno besedilo.",
  },
  {
    icon: "🗒️",
    title: "Dobi čiste zapiske",
    detail: "Urejeni zapiski in prepisi brez ročnega prepisovanja.",
  },
  {
    icon: "🧠",
    title: "Flashcardi",
    detail: "Ključni pojmi se spremenijo v kartice za hitro ponavljanje.",
  },
  {
    icon: "✅",
    title: "Kvizi",
    detail: "Preveri razumevanje z vprašanji iz svojega gradiva.",
  },
  {
    icon: "🧪",
    title: "Testi",
    detail: "Vadi daljše odgovore in pripravo na preverjanje znanja.",
  },
  {
    icon: "💬",
    title: "AI chat",
    detail: "Vprašaj zapisek in ohrani kontekst iz izvirnega gradiva.",
  },
] as const;

export default async function HomePage() {
  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUser();
    if (user) {
      redirect("/app");
    }
  }

  return (
    <main className="landing-shell landing-public-page">
      <header className="landing-public-nav">
        <Link href="/" className="landing-public-brand" aria-label={`Domov ${BRAND_NAME}`}>
          <BrandLogo subtitle="" priority />
        </Link>
        <nav className="landing-public-links" aria-label="Glavna navigacija">
          <LandingLoadingLink href="/auth/continue" className="landing-public-nav-cta">
            Preizkusi za 0 €
          </LandingLoadingLink>
        </nav>
      </header>

      <section className="landing-public-hero" aria-labelledby="landing-public-title">
        <div className="landing-public-hero-inner">
          <div className="landing-public-hero-copy">
            <div className="landing-hero-proof" aria-label="Prednosti">
              <span>Prepisi</span>
              <span>Varno</span>
              <span>Flashcardi</span>
              <span>Kvizi</span>
              <span>Testi</span>
              <span>AI chat</span>
            </div>
            <h1 id="landing-public-title">Nikoli več ne piši zapiskov</h1>
            <p>
              Memo je tvoj AI notetaker za predavanja. Iz posnetkov, PDF-jev,
              dokumentov in povezav pripravi zapiske, prepise, flashcarde,
              kvize, teste in AI chat.
            </p>
            <div className="landing-public-actions">
              <LandingLoadingLink href="/auth/continue" className="landing-public-cta primary">
                Preizkusi za 0 €
              </LandingLoadingLink>
              <LandingLoadingLink href="/auth/continue" className="landing-public-cta secondary">
                Nadaljuj na spletu
              </LandingLoadingLink>
            </div>
          </div>
          <LandingStoryPreview />
        </div>
      </section>

      <section className="landing-public-section" aria-labelledby="landing-workflow-title">
        <div className="landing-public-section-heading">
          <p className="landing-section-pill">Kako deluje</p>
          <h2 id="landing-workflow-title">Memo vse poenostavi.</h2>
        </div>

        <div className="landing-workflow-grid">
          {WORKFLOW_STEPS.map((step) => (
            <article key={step.title} className="landing-workflow-item">
              <span className="landing-workflow-icon">{step.icon}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-public-section landing-feature-section" aria-labelledby="landing-feature-title">
        <div className="landing-public-section-heading">
          <p className="landing-section-pill">Funkcije</p>
          <h2 id="landing-feature-title">Zajemi, uredi in se uči hitreje</h2>
        </div>

        <div className="landing-feature-grid">
          {FEATURE_CARDS.map((feature) => (
            <article key={feature.title} className="landing-feature-large-card">
              <span className="landing-feature-large-icon">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-public-section" id="examples" aria-labelledby="landing-examples-title">
        <div className="landing-public-section-heading">
          <p className="landing-section-pill">Učno gradivo</p>
          <h2 id="landing-examples-title">Flashcardi, kvizi, testi in AI chat iz istega zapiska.</h2>
        </div>

        <div className="landing-example-grid">
          {STUDY_EXAMPLES.map((example) => (
            <article key={example.label} className="landing-example-card">
              <p className="landing-example-label">{example.label}</p>
              <h3>{example.title}</h3>
              <p>{example.detail}</p>
              <span>{example.meta}</span>
            </article>
          ))}
        </div>
      </section>

    </main>
  );
}
