import Image from "next/image";

export default function AppLoading() {
  return (
    <div className="app-loading-shell" aria-hidden="true">
      <div className="app-loading-brand">
        <div className="app-loading-brand-mark">
          <Image
            src="/memo-logo.png"
            alt=""
            width={88}
            height={88}
            className="app-loading-brand-image"
            priority
          />
        </div>
      </div>

      <div className="app-loading-header">
        <div className="app-loading-pill app-loading-pill-title" />
        <div className="app-loading-pill app-loading-pill-subtitle" />
      </div>

      <div className="app-loading-grid">
        <div className="ios-card app-loading-card app-loading-card-tall">
          <div className="app-loading-pill app-loading-pill-section" />
          <div className="app-loading-row" />
          <div className="app-loading-row" />
          <div className="app-loading-row short" />
        </div>

        <div className="ios-card app-loading-card">
          <div className="app-loading-pill app-loading-pill-section" />
          <div className="app-loading-note" />
          <div className="app-loading-note" />
          <div className="app-loading-note" />
        </div>
      </div>
    </div>
  );
}
