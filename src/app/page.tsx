import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-logo";
import { LandingAuthOptions } from "@/components/landing-auth-options";
import { getAuthProviderAvailability } from "@/lib/auth-providers";
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
    detail: "Flashcardi, kvizi, testna vprašanja in klepet z zapiski.",
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
    title: "Record or upload",
    detail: "Lectures, PDFs, documents, links and pasted text.",
  },
  {
    icon: "🗒️",
    title: "Get clean notes",
    detail: "Organized notes and transcripts without manual rewriting.",
  },
  {
    icon: "💬",
    title: "AI Chat",
    detail: "Ask the note and keep context from the original material.",
  },
] as const;

export default async function HomePage() {
  const isVercelPreview = process.env.VERCEL_ENV === "preview";

  if (hasPublicSupabaseEnv) {
    const user = await getOptionalUser();
    if (user) {
      redirect("/app");
    }
  }

  const providers = hasPublicSupabaseEnv
    ? await getAuthProviderAvailability()
    : { apple: false, email: false, google: false };

  return (
    <main className="landing-shell landing-public-page">
      <header className="landing-public-nav">
        <Link href="/" className="landing-public-brand" aria-label={`Domov ${BRAND_NAME}`}>
          <BrandLogo priority />
        </Link>
        <nav className="landing-public-links" aria-label="Glavna navigacija">
          <Link href="#examples">Primeri</Link>
          <Link href="#continue" className="landing-public-nav-cta">
            Try for $0
          </Link>
        </nav>
      </header>

      <section className="landing-public-hero" aria-labelledby="landing-public-title">
        <div className="landing-public-hero-inner">
          <div className="landing-public-hero-copy">
            <div className="landing-hero-proof" aria-label="Prednosti">
              <span>Transcripts</span>
              <span>Secure</span>
              <span>Flashcards</span>
              <span>Quizzes</span>
            </div>
            <h1 id="landing-public-title">Never take notes again</h1>
            <p>
              Memo je tvoj AI pomočnik za predavanja. Iz posnetkov, PDF-jev,
              dokumentov in povezav pripravi zapiske, prepise in učno gradivo.
            </p>
            <div className="landing-public-actions">
              <Link href="#continue" className="landing-public-cta primary">
                Try for $0
              </Link>
              <Link href="#continue" className="landing-public-cta secondary">
                Continue on web
              </Link>
            </div>
          </div>

          <div className="landing-phone-preview" aria-label="Primer Memo aplikacije">
            <div className="landing-phone-frame">
              <div className="landing-phone-bars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="landing-phone-topline">
                <span className="landing-phone-logo">
                  <Image
                    src="/memo-logo.png"
                    alt=""
                    width={3651}
                    height={3285}
                    sizes="1.7rem"
                  />
                </span>
                <strong>memoai.eu</strong>
                <span>2 min ago</span>
              </div>
              <div className="landing-phone-note">
                <Image
                  src="/hero-nota-illustration.svg"
                  alt=""
                  fill
                  sizes="18rem"
                  className="landing-phone-image"
                />
                <div className="landing-phone-note-content">
                  <p>Chat with your notes</p>
                  <div className="landing-phone-chat-card">
                    <span>NEW</span>
                    <strong>Vprašaj zapisek</strong>
                    <p>Razloži mi glavno idejo in pripravi 5 flashcardov.</p>
                    <div>Ustvari kviz ↑</div>
                  </div>
                </div>
              </div>
            </div>
            <span className="landing-phone-badge" aria-hidden="true">
              <Image src="/memo-logo.png" alt="" width={3651} height={3285} sizes="3.3rem" />
            </span>
          </div>
        </div>
      </section>

      <section className="landing-public-section" aria-labelledby="landing-workflow-title">
        <div className="landing-public-section-heading">
          <p className="landing-section-pill">How it works</p>
          <h2 id="landing-workflow-title">Memo keeps it simple.</h2>
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
          <p className="landing-section-pill">Features</p>
          <h2 id="landing-feature-title">Capture, organize, and learn faster</h2>
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
          <p className="landing-section-pill">Study materials</p>
          <h2 id="landing-examples-title">Flashcards, quizzes, tests and chat from the same note.</h2>
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

      <section className="landing-continue-section" id="continue" aria-labelledby="landing-continue-title">
        <div className="landing-continue-copy">
          <p className="landing-public-eyebrow">Začni</p>
          <h2 id="landing-continue-title">Nadaljuj v aplikacijo, ko si pripravljen.</h2>
          <p>
            Tvoj prvi zapisek lahko začneš iz posnetka, datoteke, besedila ali
            povezave. Vse učno gradivo ostane skupaj v knjižnici.
          </p>
        </div>

        <div className="landing-continue-panel">
          <LandingAuthOptions providers={providers} next="/app/start" />

          <p className="landing-auth-legal landing-public-legal">
            Z nadaljevanjem se strinjaš s {`${BRAND_NAME}`}{" "}
            <Link href="/app/support/terms-of-use">pogoji uporabe</Link> in{" "}
            <Link href="/app/support/privacy-policy">politiko zasebnosti</Link>, vključno z AI
            obdelavo zvoka, besedila, dokumentov in povezav. Potrjuješ tudi, da imaš
            potrebna dovoljenja za snemanje, nalaganje in uporabo gradiva, ki ga pošlješ
            v Memo.
          </p>

          {!hasPublicSupabaseEnv ? (
            <div className="dashboard-surface-card landing-env-warning">
              <p className="ios-info ios-danger">
                {isVercelPreview
                  ? "Vercel Preview nima nastavljenih `NEXT_PUBLIC_SUPABASE_URL` in/ali `NEXT_PUBLIC_SUPABASE_ANON_KEY`."
                  : "Manjkajo javne `Supabase` okoljske spremenljivke. Izpolni `.env.local`."}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
