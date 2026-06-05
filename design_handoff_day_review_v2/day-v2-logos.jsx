/* global React */
// Six logo directions for Time Logger. Each exports a <Mark/> and an optional
// inline-animated variant. All sized via CSS (default 22px). Color is currentColor
// or var(--accent) so they re-tint with the accent system.

const LogoStack = ({ size = 22, animate = false }) => {
  // Three time-block bars at varying widths — ties the mark to the ribbon.
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-label="Time Logger">
      <rect x="2"  y="5"  width="20" height="4" rx="1.2" fill="var(--accent)"/>
      <rect x="2"  y="11" width="13" height="4" rx="1.2" fill="var(--accent)" opacity="0.55"/>
      <rect x="2"  y="17" width="17" height="4" rx="1.2" fill="var(--accent)" opacity="0.8">
        {animate && <animate attributeName="width" values="0;17;17" dur="1.2s" fill="freeze"/>}
      </rect>
    </svg>
  );
};

const LogoArc = ({ size = 22, animate = false, pct = 78 }) => {
  // Arc-of-progress mark. Mirrors the ring component. `pct` lets it double as a
  // status indicator (the day's coverage).
  const s = size;
  const r = 8.5, c = 2 * Math.PI * r;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-label="Time Logger">
      <circle cx="12" cy="12" r={r} stroke="currentColor" strokeWidth="2.2" opacity="0.18"/>
      <circle cx="12" cy="12" r={r} stroke="var(--accent)" strokeWidth="2.6"
              strokeDasharray={c} strokeDashoffset={c - (c * pct / 100)}
              strokeLinecap="round" transform="rotate(-90 12 12)">
        {animate && <animate attributeName="stroke-dashoffset" from={c} to={c - (c * pct / 100)} dur="0.9s" fill="freeze"/>}
      </circle>
      <circle cx="12" cy="12" r="2.2" fill="var(--accent)"/>
    </svg>
  );
};

const LogoMono = ({ size = 22 }) => {
  // Geometric "TL" monogram — a T whose crossbar is also the L stem.
  // Stark, type-driven mark that scales well as a favicon.
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-label="Time Logger">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--accent)"/>
      <path d="M6 7.5h12M12 7.5v9.5M12 17h6"
            stroke="var(--accent-fg)" strokeWidth="2.2" strokeLinecap="square"/>
    </svg>
  );
};

const LogoClock = ({ size = 22, animate = false }) => {
  // Clock with the minute hand sweeping into a wedge — angular, more graphic
  // than literal. Wedge fills with the accent.
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-label="Time Logger">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.5" opacity="0.35"/>
      {/* wedge from 12 to ~4 o'clock */}
      <path d="M12 12 L12 2.5 A9.5 9.5 0 0 1 20.23 16.75 Z" fill="var(--accent)" opacity="0.9">
        {animate && <animateTransform attributeName="transform" type="rotate" from="-360 12 12" to="0 12 12" dur="1.4s" fill="freeze"/>}
      </path>
      <circle cx="12" cy="12" r="1.7" fill="currentColor"/>
    </svg>
  );
};

const LogoHourglass = ({ size = 22 }) => {
  // Stylized hourglass — two stacked time-wedges, top accent, bottom outlined.
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-label="Time Logger">
      <path d="M5 3h14l-7 9 7 9H5l7-9z" fill="var(--accent)" opacity="0.95"/>
      <path d="M5 3h14l-7 9 7 9H5l7-9z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" opacity="0.35"/>
      <path d="M12 12l-4 6h8z" fill="var(--accent-fg)" opacity="0.85"/>
    </svg>
  );
};

const LogoTLCarve = ({ size = 22 }) => {
  // The original — a rounded square with a clock hand carved out. Refined:
  // sharper hand, double-tick at the 12.
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-label="Time Logger">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--accent)"/>
      <circle cx="12" cy="12" r="6.5" stroke="var(--accent-fg)" strokeWidth="1.4" opacity="0.55"/>
      <path d="M12 12 L12 6.5" stroke="var(--accent-fg)" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 12 L16 13.5" stroke="var(--accent-fg)" strokeWidth="2" strokeLinecap="round" opacity="0.85"/>
      <circle cx="12" cy="12" r="1.2" fill="var(--accent-fg)"/>
    </svg>
  );
};

// ------- Registry --------------------------------------------
const LOGOS = {
  stack:     { id: "stack",     name: "Block Stack",   Mark: LogoStack,     blurb: "Three logged blocks. Echoes the ribbon." },
  arc:       { id: "arc",       name: "Progress Arc",  Mark: LogoArc,       blurb: "Doubles as the day's coverage indicator." },
  mono:      { id: "mono",      name: "TL Monogram",   Mark: LogoMono,      blurb: "Type-driven. Scales tiny." },
  clock:     { id: "clock",     name: "Wedge Clock",   Mark: LogoClock,     blurb: "Time wedge, more graphic than literal." },
  hourglass: { id: "hourglass", name: "Hourglass",     Mark: LogoHourglass, blurb: "Two stacked time-wedges." },
  carve:     { id: "carve",     name: "Carved Clock",  Mark: LogoTLCarve,   blurb: "Refined original — clock face carved out." },
};

// Renders the selected logo + the wordmark, used in the v2 topbar.
const BrandLockup = ({ variant = "stack", page = "Day review", animateOnMount = false }) => {
  const entry = LOGOS[variant] || LOGOS.stack;
  const Mark = entry.Mark;
  return (
    <div className="brand-v2">
      <Mark size={26} animate={animateOnMount} />
      <span className="brand-wordmark">Time Logger</span>
      {page && <>
        <span className="brand-sep-v2">/</span>
        <span className="brand-page-v2">{page}</span>
      </>}
    </div>
  );
};

Object.assign(window, { LOGOS, BrandLockup, LogoStack, LogoArc, LogoMono, LogoClock, LogoHourglass, LogoTLCarve });
