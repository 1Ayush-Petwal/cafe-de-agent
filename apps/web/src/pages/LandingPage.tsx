import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ThemeToggle } from '../theme/ThemeToggle';

/**
 * The public front door at `/`. Every other route lives inside the 960px app
 * shell; this page is full-bleed and carries its own header and footer.
 *
 * All product copy here was signed off section by section - change it with
 * the same care, and keep every claim backed by something the app ships.
 */

const SECTIONS = [
  { href: '#how', label: 'How it works' },
  { href: '#agent', label: 'Booking agent' },
  { href: '#mandates', label: 'Mandates' },
  { href: '#cafes', label: 'For cafés' },
  { href: '#faq', label: 'FAQ' },
];

const STEPS = [
  { title: 'Find a café', body: 'Search by locality, sort by distance or rating, see it on the map.' },
  { title: 'Hold a table', body: 'Your table is held for 5 minutes while you decide. Walk away and it frees itself.' },
  { title: 'Confirm and go', body: 'Pay, get a confirmation, and cancel any time from My reservations.' },
];

const ICON = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  pen: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  refund: 'M3 12a9 9 0 1 0 2.64-6.36M3 4v5h5',
  log: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
};

const PILLARS = [
  {
    icon: ICON.pen,
    title: 'A mandate you sign',
    body: 'Set a per-booking cap, total budget, booking count, localities and dates. The bounds are signed, so they can’t be quietly changed.',
    instead: 'handing a bot your card',
  },
  {
    icon: ICON.lock,
    title: 'Checked at the moment of payment',
    body: 'The limit check and the spend are one database operation, so parallel retries can’t overspend.',
    instead: 'a check that races',
  },
  {
    icon: ICON.refund,
    title: 'Real payments, safe failures',
    body: 'Razorpay test mode, with the signed webhook as the source of truth. If a booking fails after payment, you’re refunded and the table is released.',
    instead: 'a stuck charge',
  },
  {
    icon: ICON.log,
    title: 'Every decision on record',
    body: 'Approvals and refusals, each with the reason and the mandate as it stood.',
    instead: 'a log of successes only',
  },
];

// ponytail: copied from docs/eval-harness-report.md by hand; re-copy when the harness is re-run.
const STATS = [
  { value: '83.3%', label: 'fill rate (vs 80%)' },
  { value: '+₹400', label: 'revenue on the same demand' },
  { value: '0', label: 'double bookings' },
  { value: '0', label: 'failed refunds' },
];

const FAQS = [
  { q: 'Is the money real?', a: 'Payments run on Razorpay test mode, so no real money moves.' },
  {
    q: 'What if I hold a table and walk away?',
    a: 'The hold expires after 5 minutes and the table goes back on sale.',
  },
  {
    q: 'Can the agent spend more than I allowed?',
    a: 'No. Every payment is checked against your signed mandate, and a refusal is logged with the reason.',
  },
  { q: 'Which cities?', a: 'Delhi only for now, so the list stays curated and availability is real.' },
  {
    q: 'Can I book the same café twice in one evening?',
    a: 'One booking per person per café within a 10-hour window.',
  },
  { q: 'I run a café. How do I join?', a: 'Sign up as an owner, add your tables and generate slots.' },
];

// Mock data. Prices follow the real grid: a ₹400 band, x1.5 for 19:00-21:00,
// x1.3 on Saturday, and a 20% nudge on a cold slot.
const HERO_TIMES = [
  { time: '17:00', quiet: true },
  { time: '18:00' },
  { time: '19:00', on: true },
  { time: '20:00' },
  { time: '21:00', off: true },
];

const HERO_TABLES = [
  { label: 'T1', seats: 2, state: '' },
  { label: 'T2', seats: 4, state: 'selected' },
  { label: 'T3', seats: 4, state: 'reserved' },
  { label: 'T4', seats: 8, state: '' },
];

// Demand by hour, 11:00-23:00. Below 0.35 is cold, matching COLD_THRESHOLD.
const DEMAND = [0.3, 0.45, 0.55, 0.5, 0.4, 0.3, 0.25, 0.6, 0.85, 0.95, 0.9, 0.6, 0.38];

const OWNER_ROWS = [
  { time: '17:00', table: 'T1 · 2 guests', amount: '₹416' },
  { time: '19:00', table: 'T2 · 4 guests', amount: '₹780' },
  { time: '19:00', table: 'T4 · 6 guests', amount: '₹780' },
  { time: '20:00', table: 'T3 · 3 guests', amount: '₹780' },
];

const delay = (ms: number): CSSProperties => ({ transitionDelay: `${ms}ms` });

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/** Fades `.reveal` elements in as they scroll into view, once each. */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    ref.current?.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return ref;
}

export function LandingPage() {
  const { isAuthenticated, user } = useAuth();
  const isOwner = user?.role === 'owner';
  const ref = useReveal();

  return (
    <div className="landing" ref={ref}>
      <header className="l-header">
        <div className="l-wrap l-header-inner">
          <Link to="/" className="l-brand">
            <img src="/icon.svg" alt="" />
            Café De
          </Link>
          <nav className="l-anchors" aria-label="Page sections">
            {SECTIONS.map((s) => (
              <a key={s.href} href={s.href}>
                {s.label}
              </a>
            ))}
          </nav>
          <div className="l-header-actions">
            <ThemeToggle />
            {isAuthenticated ? (
              <Link to={isOwner ? '/owner' : '/cafes'} className="l-btn l-btn-primary l-btn-sm">
                {isOwner ? 'Owner dashboard' : 'Browse cafés'}
              </Link>
            ) : (
              <>
                <Link to="/login" className="l-btn l-btn-ghost l-btn-sm">
                  Log in
                </Link>
                <Link to="/signup" className="l-btn l-btn-primary l-btn-sm">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="l-hero">
          <div className="l-wrap">
            <div className="reveal">
              <a href="#mandates" className="l-announce">
                <span className="l-announce-dot" aria-hidden="true" />
                New: the booking agent now pays through Razorpay, inside limits you sign
                <Icon d={ICON.arrow} size={14} />
              </a>
              <h1 className="l-display">
                Book a Delhi café in a few taps.
                <span>Or just ask the agent.</span>
              </h1>
            </div>
            <p className="l-hero-lede reveal" style={delay(90)}>
              Live table availability across curated cafés in Delhi. Pick a slot and confirm, or tell the AI agent
              what you want and it searches, holds and books within a budget you set.
            </p>
            <div className="reveal" style={delay(160)}>
              <div className="l-actions">
                <Link to="/cafes" className="l-btn l-btn-primary">
                  Browse cafés <Icon d={ICON.arrow} />
                </Link>
                <a href="#how" className="l-btn l-btn-ghost">
                  See how it works
                </a>
              </div>
              <ul className="l-ticks">
                {['Live availability', 'No double bookings', 'Agent never exceeds your limit'].map((t) => (
                  <li key={t}>
                    <Icon d={ICON.check} size={14} />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="l-stage reveal" style={delay(240)}>
              <HeroMock />
            </div>
          </div>
        </section>

        <section className="l-strip">
          <div className="l-wrap">
            <p className="l-eyebrow">One booking platform for</p>
            <ul>
              {['Diners', 'Café owners', 'AI booking agents', 'Partner apps'].map((label) => (
                <li key={label}>
                  <span className="l-dot" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Section id="how">
          <Heading eyebrow="How it works" title="Find a table in three steps." />
          <ol className="l-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="l-card reveal" style={delay(i * 80)}>
                <span className="l-step-num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="agent" alt>
          <Story
            mockFirst
            eyebrow="Booking agent"
            title="Say what you want. The agent does the rest."
            body="Type a request the way you’d text a friend. The agent searches cafés, checks live slots, holds a table and books it, using the same booking system you do."
            checks={[
              'Understands requests like “quiet café for 3 near Hauz Khas, Saturday evening”',
              'Suggests a nearby slot when yours is full',
              'Asks before it spends, or books inside your mandate',
            ]}
            link={{ to: '/agent', label: 'Try the agent' }}
            mock={<AgentMock />}
          />
        </Section>

        <Section id="mandates">
          <div className="l-split l-split-pillars">
            <div className="reveal">
              <p className="l-eyebrow">What sets us apart</p>
              <h2 className="l-h2 l-h2-lg">
                Anyone can build a booking bot. <span className="l-accent">Few can prove it stayed in bounds.</span>
              </h2>
              <dl className="l-facts">
                <div>
                  <dt>0</dt>
                  <dd>double bookings under concurrent retry</dd>
                </div>
                <div>
                  <dt>Every</dt>
                  <dd>refusal logged with its reason</dd>
                </div>
              </dl>
            </div>
            <ol className="l-pillars">
              {PILLARS.map((p, i) => (
                <li key={p.title} className="reveal" style={delay(i * 80)}>
                  <span className="l-icon">
                    <Icon d={p.icon} size={20} />
                  </span>
                  <div>
                    <div className="l-pillar-head">
                      <h3>{p.title}</h3>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                    </div>
                    <p>{p.body}</p>
                    <p className="l-instead">
                      <Icon d={ICON.x} size={13} />
                      <span>
                        Instead of <s>{p.instead}</s>
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Section>

        <Section id="cafes" alt>
          <Story
            eyebrow="For cafés"
            title="Fill the tables that would have gone empty."
            body="An unsold 7pm table is worth nothing at 8pm. Slots are priced by hour and day, and quiet slots get a nudge so diners and agents fill them."
            checks={[
              'Add tables and generate bookable slots',
              'Watch today’s bookings arrive live',
              'API keys and webhooks for partner apps',
            ]}
            link={{ to: isAuthenticated && isOwner ? '/owner' : '/signup', label: 'List your café' }}
            mock={<OwnerMock />}
          />
        </Section>

        <section className="l-band-section">
          <div className="l-wrap">
            <div className="l-band reveal">
              <div>
                <h2 className="l-h2">Same demand, two ways.</h2>
                <p>30 synthetic buyers from one fixed seed, run through exact-match booking and through the agent.</p>
              </div>
              <dl className="l-stats">
                {STATS.map((s) => (
                  <div key={s.label}>
                    <dt>{s.value}</dt>
                    <dd>{s.label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <Section id="faq" alt>
          <Heading eyebrow="FAQ" title="Frequently asked questions" />
          <div className="l-faq reveal">
            {FAQS.map((f, i) => (
              <details key={f.q} name="faq" open={i === 0}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <section className="l-cta-section">
          <div className="l-wrap">
            <div className="l-cta reveal">
              <img src="/icon.svg" alt="" />
              <h2 className="l-h2">Your table is waiting.</h2>
              <p>Browse live availability or hand the search to the agent.</p>
              <div className="l-actions">
                <Link to="/cafes" className="l-btn l-btn-inverse">
                  Browse cafés <Icon d={ICON.arrow} />
                </Link>
                <Link to="/agent" className="l-btn l-btn-outline">
                  Talk to the agent
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="l-footer">
        <div className="l-wrap">
          <div className="l-footer-top">
            <div>
              <Link to="/" className="l-brand">
                <img src="/icon.svg" alt="" />
                Café De
              </Link>
              <p>Live café reservations in Delhi, bookable by people and AI agents.</p>
            </div>
            <nav aria-label="Footer">
              {SECTIONS.map((s) => (
                <a key={s.href} href={s.href}>
                  {s.label}
                </a>
              ))}
            </nav>
          </div>
          <p className="l-footer-bottom">
            © {new Date().getFullYear()} Café De · Payments by Razorpay (test mode)
          </p>
        </div>
      </footer>
    </div>
  );
}

function Section({ id, alt = false, children }: { id: string; alt?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={alt ? 'l-section l-section-alt' : 'l-section'}>
      <div className="l-wrap">{children}</div>
    </section>
  );
}

function Heading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="l-heading reveal">
      <p className="l-eyebrow">{eyebrow}</p>
      <h2 className="l-h2">{title}</h2>
    </div>
  );
}

function Story(props: {
  eyebrow: string;
  title: string;
  body: string;
  checks: string[];
  link: { to: string; label: string };
  mock: ReactNode;
  mockFirst?: boolean;
}) {
  return (
    <div className={props.mockFirst ? 'l-split l-split-mock-first' : 'l-split'}>
      <div className="reveal">
        <p className="l-eyebrow">{props.eyebrow}</p>
        <h2 className="l-h2">{props.title}</h2>
        <p className="l-body">{props.body}</p>
        <ul className="l-checks">
          {props.checks.map((c) => (
            <li key={c}>
              <span>
                <Icon d={ICON.check} size={12} />
              </span>
              {c}
            </li>
          ))}
        </ul>
        <Link to={props.link.to} className="l-link">
          {props.link.label} <Icon d={ICON.arrow} />
        </Link>
      </div>
      <div className="l-mock-col reveal" style={delay(90)}>
        {props.mock}
      </div>
    </div>
  );
}

/* ─── Product mocks: static, decorative, built from the app's own tokens ─── */

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="l-frame" aria-hidden="true">
      <div className="l-frame-bar">
        <div>
          <span />
          <span />
          <span />
        </div>
        <em>{label}</em>
      </div>
      {children}
    </div>
  );
}

function HeroMock() {
  return (
    <Frame label="Café De">
      <div className="l-hero-mock">
        <div className="l-pane">
          <div className="l-pane-head">
            <div>
              <strong>Hauz Khas Social</strong>
              <small>★ 4.3 · Hauz Khas Village</small>
            </div>
            <span className="l-live">Live</span>
          </div>
          <div className="l-chips">
            {['Today', 'Tomorrow', 'Sat'].map((d) => (
              <span key={d} className={d === 'Sat' ? 'on' : ''}>
                {d}
              </span>
            ))}
          </div>
          <div className="l-chips">
            {HERO_TIMES.map((t) => (
              <span key={t.time} className={t.on ? 'on' : t.off ? 'off' : ''}>
                {t.time}
                {t.quiet && <i>quiet</i>}
              </span>
            ))}
          </div>
          <div className="l-tables">
            {HERO_TABLES.map((t) => (
              <div key={t.label} className={`l-table ${t.state}`}>
                <b>{t.label}</b>
                <small>{t.seats} seats</small>
                {t.state === 'reserved' ? <em>Reserved</em> : <span>₹780</span>}
              </div>
            ))}
          </div>
          <div className="l-hold">
            <span>T2 held for you</span>
            <strong>4:52</strong>
            <span className="l-fake-btn">Confirm ₹780</span>
          </div>
        </div>
        <div className="l-pane l-pane-agent">
          <div className="l-pane-head">
            <strong>Booking agent</strong>
          </div>
          <p className="l-bubble l-bubble-you">Quiet café for 3 near Khan Market, Saturday 7pm</p>
          <p className="l-bubble">Khan Market Book Café has a 4-seat table at 19:00 for ₹780.</p>
          <ul className="l-trace">
            {['Held T3 for 5 minutes', 'Within your mandate', 'Paid via Razorpay'].map((t) => (
              <li key={t}>
                <Icon d={ICON.check} size={12} />
                {t}
              </li>
            ))}
          </ul>
          <p className="l-bubble l-bubble-done">Booking confirmed.</p>
          <p className="l-mandate">Mandate: ₹1,220 of ₹2,000 left</p>
        </div>
      </div>
    </Frame>
  );
}

function AgentMock() {
  return (
    <Frame label="Booking agent">
      <div className="l-chat">
        <p className="l-mandate">Mandate: ₹800 per booking · ₹2,000 total · Hauz Khas Village</p>
        <p className="l-bubble l-bubble-you">Table for 2 at Hauz Khas Social, Saturday 7pm</p>
        <p className="l-bubble l-bubble-tool">Agent is checking: availability…</p>
        <p className="l-bubble">19:00 is fully booked. 17:00 is quiet, so it’s ₹416 instead of ₹520. Want it?</p>
        <p className="l-bubble l-bubble-you">Yes, book 17:00</p>
        <div className="l-approval">
          <span>Within mandate</span>
          <strong>₹416 of ₹800 per booking</strong>
        </div>
        <p className="l-bubble l-bubble-done">Booking confirmed. T1, Saturday 17:00.</p>
      </div>
    </Frame>
  );
}

function OwnerMock() {
  return (
    <Frame label="Owner dashboard">
      <div className="l-owner">
        <div className="l-pane-head">
          <div>
            <strong>Hauz Khas Social</strong>
            <small>Saturday bookings</small>
          </div>
          <span className="l-live">Live</span>
        </div>
        <div className="l-kpis">
          <div>
            <small>Booked</small>
            <b>14</b>
          </div>
          <div>
            <small>Revenue</small>
            <b>₹8,960</b>
          </div>
          <div>
            <small>Quiet slots</small>
            <b>3</b>
          </div>
        </div>
        <div className="l-demand">
          <div className="l-demand-head">
            <small>Demand by hour</small>
            <span>17:00 nudged −20%</span>
          </div>
          <div className="l-bars">
            {DEMAND.map((v, i) => (
              <span key={i} className={v < 0.35 ? 'cold' : ''} style={{ height: `${v * 100}%` }} />
            ))}
          </div>
          <div className="l-bars-axis">
            <span>11:00</span>
            <span>17:00</span>
            <span>23:00</span>
          </div>
        </div>
        <ul className="l-rows">
          {OWNER_ROWS.map((r) => (
            <li key={r.time + r.table}>
              <b>{r.time}</b>
              <span>{r.table}</span>
              <span className="l-row-amount">{r.amount}</span>
              <em>Booked</em>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}
