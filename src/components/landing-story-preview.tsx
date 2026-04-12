"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

const STORY_SLIDES = [
  {
    kind: "notes",
    title: "Clean zapiski",
    caption: "Predavanje postane urejen povzetek.",
    label: "Zapiski",
  },
  {
    kind: "transcript",
    title: "Prepis predavanja",
    caption: "Besedilo ostane povezano z izvorom.",
    label: "Prepis",
  },
  {
    kind: "flashcards",
    title: "Flashcardi",
    caption: "Ključni pojmi za hitro ponavljanje.",
    label: "Flashcardi",
  },
  {
    kind: "quiz",
    title: "Kvizi",
    caption: "Vprašanja iz tvojega gradiva.",
    label: "Kvizi",
  },
  {
    kind: "test",
    title: "Testi",
    caption: "Vaja za daljše odgovore in izpite.",
    label: "Testi",
  },
  {
    kind: "chat",
    title: "AI chat",
    caption: "Vprašaj zapisek in dobi odgovor.",
    label: "AI chat",
  },
] as const;

const STORY_AUTOPLAY_MS = 3200;

function StoryGraphic({ kind }: { kind: (typeof STORY_SLIDES)[number]["kind"] }) {
  if (kind === "notes") {
    return (
      <div className="landing-story-notes" aria-hidden="true">
        <strong>Ključni pojmi</strong>
        <span />
        <span />
        <span className="short" />
        <em>3 pomembne točke</em>
      </div>
    );
  }

  if (kind === "transcript") {
    return (
      <div className="landing-story-transcript" aria-hidden="true">
        <p>00:42 Uvod v temo</p>
        <p>02:15 Primer iz predavanja</p>
        <p>04:08 Zaključek</p>
      </div>
    );
  }

  if (kind === "quiz") {
    return (
      <div className="landing-story-quiz" aria-hidden="true">
        <strong>Kaj encimi najpogosteje naredijo?</strong>
        <span>A Pospešijo reakcije</span>
        <span>B Ustavijo celice</span>
        <span>C Shranijo energijo</span>
      </div>
    );
  }

  if (kind === "test") {
    return (
      <div className="landing-story-test" aria-hidden="true">
        <strong>Test</strong>
        <p>Primerjaj mitozo in mejozo.</p>
        <span />
        <span />
      </div>
    );
  }

  if (kind === "chat") {
    return (
      <div className="landing-story-chat" aria-hidden="true">
        <p>Zakaj je to pomembno?</p>
        <p>Ker se pogosto pojavi pri primerjavi pojmov.</p>
      </div>
    );
  }

  return (
    <div className="landing-story-flashcard" aria-hidden="true">
      <strong>Flashcard</strong>
      <p>Kaj je aktivni priklic?</p>
    </div>
  );
}

export function LandingStoryPreview() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeSlide = STORY_SLIDES[activeIndex];
  const storyStyle = { "--story-duration": `${STORY_AUTOPLAY_MS}ms` } as CSSProperties;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current === STORY_SLIDES.length - 1 ? 0 : current + 1));
    }, STORY_AUTOPLAY_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  function showPrevious() {
    setActiveIndex((current) => (current === 0 ? STORY_SLIDES.length - 1 : current - 1));
  }

  function showNext() {
    setActiveIndex((current) => (current === STORY_SLIDES.length - 1 ? 0 : current + 1));
  }

  return (
    <div className="landing-study-visual" aria-label="Primeri učnega gradiva">
      <div className={`landing-study-story landing-study-story-${activeSlide.kind}`} style={storyStyle}>
        <div className="landing-study-story-bars" aria-label="Izberi primer">
          {STORY_SLIDES.map((slide, index) => (
            <button
              type="button"
              key={slide.kind}
              className={index === activeIndex ? "active" : ""}
              aria-label={`Pokaži ${slide.label}`}
              aria-current={index === activeIndex ? "step" : undefined}
              onClick={() => {
                setActiveIndex(index);
              }}
            >
              <span />
            </button>
          ))}
        </div>

        <div className="landing-study-story-brand">
          <span className="landing-study-story-logo">
            <Image src="/memo-logo.png" alt="" width={3651} height={3285} sizes="2.4rem" />
          </span>
          <span>memoai.eu</span>
          <small>{activeSlide.label}</small>
        </div>

        <div key={`${activeSlide.kind}-card`} className="landing-study-story-card">
          <StoryGraphic kind={activeSlide.kind} />
        </div>

        <div key={`${activeSlide.kind}-copy`} className="landing-study-story-copy">
          <p className="landing-study-story-title">{activeSlide.title}</p>
          <p>{activeSlide.caption}</p>
        </div>

        <div className="landing-study-story-controls" aria-label="Story navigacija">
          <button type="button" aria-label="Prejšnji primer" onClick={showPrevious}>
            ←
          </button>
          <button type="button" aria-label="Naslednji primer" onClick={showNext}>
            →
          </button>
        </div>
      </div>
    </div>
  );
}
