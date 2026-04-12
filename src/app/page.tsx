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
    title: "Dodaj gradivo",
    detail: "Posnemi predavanje, naloži zvok, prilepi besedilo ali dodaj povezavo.",
  },
  {
    title: "Preberi jasne zapiske",
    detail: "Memo izlušči glavne ideje, razlago in strukturo za hitro ponavljanje.",
  },
  {
    title: "Uči se aktivno",
    detail: "Iz iste vsebine dobiš flashcarde, kvize, testna vprašanja in klepet.",
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
            Nadaljuj
          </Link>
        </nav>
      </header>

      <section className="landing-public-hero" aria-labelledby="landing-public-title">
        <Image
          src="/hero-nota-illustration.svg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="landing-public-hero-image"
        />
        <div className="landing-public-hero-shade" />

        <div className="landing-public-hero-inner">
          <p className="landing-public-eyebrow">AI zapiski za predavanja</p>
          <h1 id="landing-public-title">Iz gradiva do učenja v enem prostoru.</h1>
          <p>
            Posnemi predavanje, naloži dokument ali dodaj povezavo. Memo pripravi
            zapiske, flashcarde, kvize, testna vprašanja in klepet z vsebino.
          </p>
          <div className="landing-public-actions">
            <Link href="#continue" className="landing-public-cta primary">
              Nadaljuj v Memo
            </Link>
            <Link href="#examples" className="landing-public-cta secondary">
              Poglej primere
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-public-section" aria-labelledby="landing-workflow-title">
        <div className="landing-public-section-heading">
          <p className="landing-public-eyebrow">Tok dela</p>
          <h2 id="landing-workflow-title">Od predavanja do ponavljanja.</h2>
        </div>

        <div className="landing-workflow-grid">
          {WORKFLOW_STEPS.map((step, index) => (
            <article key={step.title} className="landing-workflow-item">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-public-section" id="examples" aria-labelledby="landing-examples-title">
        <div className="landing-public-section-heading">
          <p className="landing-public-eyebrow">Primeri</p>
          <h2 id="landing-examples-title">Čist pogled na to, kar dobiš iz zapiska.</h2>
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
