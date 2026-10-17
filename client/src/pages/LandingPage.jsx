import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import SynapseLogo from '../components/SynapseLogo';
import TopNav from '../components/TopNav';
import EditorFragment from '../components/EditorFragment';
import roomCollabShot from '../assets/landing/room-collab.jpg';
import roomRunShot from '../assets/landing/room-run.jpg';
import roomClip from '../assets/landing/room-clip.webm';
import roomClipPoster from '../assets/landing/room-clip-poster.png';
import './landing.css';

const REPO_URL = 'https://github.com/Adityatex/Synapse';
const EXAMPLES = ['OS lab assignment', 'Hackathon backend', 'Mock interview'];

const NOTES = [
  { id: 'files', side: 'left', top: 8, name: 'Files and folders', text: 'A room holds a whole project, not one snippet. Add files and folders from the explorer.' },
  { id: 'lock', side: 'left', top: 128, name: 'Edit locks', text: 'One person types in a file at a time, so edits never collide. Everyone else watches it change live.' },
  { id: 'people', side: 'left', top: 236, name: 'Who is here', text: 'See everyone in the room and the file each of them has open.' },
  { id: 'chat', side: 'right', top: 340, name: 'Room chat', text: 'Talk next to the code: replies, reactions, pinned messages, @mentions and search.' },
  { id: 'run', side: 'right', top: 500, name: 'Run and save', text: 'Pick the language, pass input through stdin, run it, and save a version of the file.' },
  { id: 'neura', side: 'right', top: 610, name: 'Neura', text: 'An assistant that reads the file you have open and answers inside the room.' },
];

const STEPS = [
  { clause: 'First you name a room.' },
  { clause: 'Then you send one link.' },
  { clause: 'Everyone edits the same file.' },
  { clause: 'Then anyone in the room runs it.' },
];

const FAQS = [
  {
    q: 'Do I need to install anything?',
    a: 'No. Synapse runs in the browser, and your code runs in a sandbox on the server through Judge0. A laptop with a current browser is enough.',
  },
  {
    q: 'Which languages can I run?',
    a: 'Python, JavaScript (Node.js), C++ and Java. Pick the language in the room’s toolbar; stdin is there too if your program reads input.',
  },
  {
    q: 'How do people join my room?',
    a: 'Press Invite inside the room. It copies a link that stays valid for seven days. Whoever opens it signs in, or creates an account, and lands in the room as a member.',
  },
  {
    q: 'Can two people type in the same file at once?',
    a: 'One person holds a file’s edit lock at a time, so edits never collide. Everyone else sees each keystroke as it happens, and the lock passes on once that person stops editing.',
  },
  {
    q: 'What can Neura, the assistant, see?',
    a: 'The file you have open and the question you ask. It answers inside the room, using the open gpt-oss-120b model hosted on Groq.',
  },
  {
    q: 'Is my code saved?',
    a: 'Yes. Rooms and their files are stored, so you can close the tab and come back from your dashboard. Save version keeps a snapshot of the file.',
  },
  {
    q: 'How do I sign in?',
    a: 'With your email and password, then a six-digit code we send to that email.',
  },
  {
    q: 'Who builds Synapse?',
    a: 'A three-person student team, as a college project. There are no paid plans.',
  },
];

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Reel progress through the pinned hero: 0 → (frames - 1).
function useHeroReel(frames) {
  const heroRef = useRef(null);
  const reelRef = useRef(null);

  useEffect(() => {
    const hero = heroRef.current;
    const reel = reelRef.current;
    if (!hero || !reel) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (window.innerWidth < 900 || prefersReducedMotion()) {
        reel.style.setProperty('--p', '0');
        return;
      }
      const rect = hero.getBoundingClientRect();
      const travel = hero.offsetHeight - window.innerHeight;
      const t = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      const p = t * (frames - 1);
      reel.style.setProperty('--p', p.toFixed(4));
      reel.querySelectorAll('.lp-frame').forEach((frame, i) => {
        frame.style.setProperty('--frame-in', String(Math.max(0, 1 - Math.abs(p - i))));
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [frames]);

  return { heroRef, reelRef };
}

// Adds .is-in to [data-reveal] blocks as they enter the viewport.
function useReveal(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const blocks = root.querySelectorAll('[data-reveal]');
    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
      blocks.forEach((b) => b.classList.add('is-in'));
      return undefined;
    }
    root.classList.add('lp--motion');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );
    blocks.forEach((b) => io.observe(b));
    return () => io.disconnect();
  }, [rootRef]);
}

function InviteFragment() {
  return (
    <div className="frag" data-ui style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8%' }}>
      <div className="ui-card" style={{ width: '100%', background: 'var(--ed-chrome)' }}>
        <div className="ui-card-title">Invite link copied</div>
        <div className="ui-card-sub" style={{ letterSpacing: 0, marginTop: 4 }}>Anyone with this link can join DSA practice for 7 days.</div>
        <div className="ui-card-row" style={{ background: 'var(--ed-bg)' }}>
          <code>synapse/room/3VNXXF?invite=eyJ0eXAiOiJyb29t…</code>
          <span className="ui-card-ok">Copied</span>
        </div>
      </div>
    </div>
  );
}

// What a new room opens with: its bar, the starter file every room gets,
// and where the invite link comes from.
function RoomBarFragment({ name }) {
  return (
    <div className="ui-roombar" data-ui>
      <div className="ui-roombar-top">
        <span className="ui-roombar-mark">
          <SynapseLogo size={18} color="#0d2a1c" nodeColor="#0d2a1c" />
        </span>
        <span className="ui-roombar-name">
          <strong>{name.trim() || 'Untitled room'}</strong>
          <span>New room · 1 person here</span>
        </span>
        <span className="ui-roombar-spacer" />
        <span className="ui-chip ui-chip--run">Run</span>
        <span className="ui-chip">Invite</span>
      </div>
      <div className="ui-roombar-tab">main.py</div>
      <pre className="ui-roombar-code">
        <code>
          <span className="ui-roombar-line"><span className="ui-roombar-ln">1</span>print(<span className="ui-str">&quot;Welcome to Synapse collaborative mode!&quot;</span>)</span>
          <span className="ui-roombar-line"><span className="ui-roombar-ln">2</span>print(<span className="ui-str">&quot;Invite someone to this room and start coding together.&quot;</span>)</span>
        </code>
      </pre>
      <div className="ui-roombar-invite">
        <span>Invite</span> copies a link to this room that works for 7 days.
      </div>
    </div>
  );
}

function SidebarPanel({ active }) {
  const part = (id) => `ui-part ${active === id ? 'is-active' : ''}`;
  return (
    <div className="ui-panel" data-ui aria-hidden="true">
      <div className={part('files')}>
        <div className="ui-part-title">Explorer</div>
        <div className="ui-row">src</div>
        <div className="ui-row ui-row--indent ui-row--selected">
          main.py
          <span className="ui-lock" style={active === 'lock' ? { outline: '2px solid #f6e016' } : undefined}>Riya</span>
        </div>
        <div className="ui-row ui-row--indent">search.py</div>
        <div className="ui-row ui-row-muted">README.md</div>
      </div>
      <div className={part('people')}>
        <div className="ui-part-title">In this room</div>
        <div className="ui-row">
          <span className="ui-avatar" style={{ background: '#f4a6a6' }}>R</span>Riya Sharma
          <span className="ui-row-muted" style={{ marginLeft: 'auto' }}>main.py</span>
        </div>
        <div className="ui-row">
          <span className="ui-avatar" style={{ background: '#7dd3fc' }}>A</span>Arjun Mehta
          <span className="ui-row-muted" style={{ marginLeft: 'auto' }}>search.py</span>
        </div>
      </div>
      <div className={part('chat')}>
        <div className="ui-part-title">Chat</div>
        <div className="ui-msg">
          <div className="ui-msg-head">Arjun <span>2 min ago</span></div>
          <span className="ui-mention">@Riya</span> line 7 needs lo = mid + 1, otherwise it loops forever.
          <div><span className="ui-reaction">+1 · 2</span></div>
        </div>
        <div className="ui-msg">
          <div className="ui-msg-head">Riya <span>just now</span></div>
          Fixed. Running it now.
        </div>
      </div>
      <div className={part('run')}>
        <div className="ui-part-title">Run</div>
        <div className="ui-input">Python · stdin: none</div>
        <div className="ui-actions">
          <span className="ui-chip ui-chip--run">Run</span>
          <span className="ui-chip">Save version</span>
        </div>
      </div>
      <div className={part('neura')}>
        <div className="ui-part-title">Neura</div>
        <div className="ui-input">Ask about search.py…</div>
      </div>
    </div>
  );
}

function CardFragment({ step }) {
  return (
    <div className="ui-card" data-ui>
      <div className="ui-card-title">DSA practice</div>
      <div className="ui-card-sub">3VNXXF</div>
      {step >= 1 && (
        <div className="ui-card-row">
          <code>…/room/3VNXXF?invite=…</code>
          <span className="ui-card-ok">Copied</span>
        </div>
      )}
      {step >= 2 && (
        <div className="ui-card-row">
          <span className="ui-faces">
            <span className="ui-avatar" style={{ background: '#f4a6a6' }}>R</span>
            <span className="ui-avatar" style={{ background: '#7dd3fc' }}>A</span>
            <span className="ui-avatar" style={{ background: '#9fe0bb' }}>K</span>
          </span>
          <span style={{ color: 'var(--ed-soft)' }}>Riya is editing main.py</span>
        </div>
      )}
      {step >= 3 && (
        <div className="ui-card-row" style={{ justifyContent: 'space-between' }}>
          <code className="ui-card-out">found 58 at index 3</code>
          <span style={{ color: 'var(--ed-muted)', fontSize: 12 }}>0.011 s</span>
        </div>
      )}
    </div>
  );
}

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const { heroRef, reelRef } = useHeroReel(4);
  const [roomName, setRoomName] = useState('DSA practice');
  const [activeNote, setActiveNote] = useState(null);
  useEffect(() => {
    document.body.style.backgroundColor = '#f7f7f7';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  useReveal(rootRef);
  // Display size shrinks as the name grows so it always fits on one line
  // (Jost caps average about 0.66em wide).
  const trySize = `min(var(--step-display), calc((100vw - 2 * var(--margin)) / ${(Math.max(roomName.length, 10) * 0.66).toFixed(2)}))`;

  function startRoom(e) {
    e?.preventDefault();
    const name = roomName.trim();
    navigate(name ? `/create-room?name=${encodeURIComponent(name)}` : '/create-room');
  }

  const primaryAction = isAuthenticated
    ? { to: '/dashboard', label: 'Open dashboard' }
    : { to: '/signup', label: 'Start a room' };

  return (
    <div className="lp" data-theme="light" ref={rootRef}>
      <TopNav overlay>
        <a href="#features" className="lp-link lp-hide-sm">Features</a>
        <a href="#how" className="lp-link lp-hide-sm">How it works</a>
        <a href="#faq" className="lp-link lp-hide-sm">Questions</a>
        {!isAuthenticated && <Link to="/login" className="lp-link">Log in</Link>}
        <Link to={primaryAction.to} className="lp-btn">{primaryAction.label}</Link>
      </TopNav>

      <main>
        <section className="lp-hero" ref={heroRef} aria-label="Synapse">
          <div className="lp-hero-stage">
            <h1 className="lp-hero-line lp-display">
              <span className="lp-hero-half lp-hero-half--l">Write code</span>{' '}
              <span className="lp-hero-half lp-hero-half--r">side by side.</span>
            </h1>
            <div className="lp-reel" ref={reelRef}>
              <div className="lp-frame">
                <EditorFragment live interactive />
              </div>
              <figure className="lp-frame">
                <img src={roomCollabShot} width="2048" height="1536" alt="Arjun’s view of a room: Riya Sharma is editing main.py, a binary search, and the file is view-only for him." />
                <figcaption className="lp-frame-caption">Arjun watches Riya’s edits arrive, live</figcaption>
              </figure>
              <figure className="lp-frame">
                <img src={roomRunShot} width="2048" height="1536" alt="The same file after Run: the output panel shows found 58 at index 3 in 0.011 seconds." loading="lazy" />
                <figcaption className="lp-frame-caption">Riya runs it: real output, 0.011 s</figcaption>
              </figure>
              <div className="lp-frame">
                <InviteFragment />
              </div>
            </div>
            <div className="lp-hero-under">
              <p className="lp-hero-lead">
                Synapse is a browser IDE for teams. Send one link, edit the same file with live cursors, and run the
                code without installing anything.
              </p>
              <Link to={primaryAction.to} className="lp-btn lp-btn--ink">{primaryAction.label}</Link>
            </div>
            <p className="lp-hero-langs">Python · JavaScript · C++ · Java</p>
          </div>
        </section>

        <section className="lp-watch" aria-labelledby="watch-heading">
          <div className="lp-watch-copy" data-reveal>
            <h2 id="watch-heading" className="lp-head">Watch a room</h2>
            <p>
              Recorded in Synapse, not mocked up. Arjun types two lines from his own browser. They appear in Riya’s file
              with his name on the cursor, and the file stays view-only for her while he types. Then she presses Run.
            </p>
          </div>
          <figure className="lp-watch-media">
            <video
              className="lp-watch-video"
              src={roomClip}
              poster={roomClipPoster}
              width="864"
              height="668"
              muted
              loop
              playsInline
              autoPlay={!prefersReducedMotion()}
              controls={prefersReducedMotion()}
              preload="metadata"
              aria-label="Screen recording of a Synapse room: Arjun Mehta types a loop into Riya Sharma's file from another browser, then Riya runs it and the output greets both of them."
            />
          </figure>
        </section>

        <section className="lp-try" aria-labelledby="try-label" data-reveal>
          <p id="try-label" className="sr-only">Name a room</p>
          <div className="lp-try-field" style={{ '--try-size': trySize }}>
            {/* The visible line: the text plus a caret set inline on its baseline. */}
            <span className="lp-try-mirror" aria-hidden="true">
              {roomName}
              <span className="lp-try-caret" />
            </span>
            <input
              className="lp-try-input"
              aria-labelledby="try-label"
              value={roomName}
              maxLength={40}
              spellCheck={false}
              onChange={(e) => setRoomName(e.target.value)}
            />
          </div>
          <div className="lp-try-answer">
            <RoomBarFragment name={roomName} />
            <div className="lp-try-act">
              <button type="button" className="lp-btn" onClick={startRoom}>Create this room</button>
              <p className="lp-try-note">Type a name above to see your room. You’ll sign in first, then it opens.</p>
            </div>
          </div>
          <div className="lp-try-examples" role="group" aria-label="Example room names">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="lp-try-example" onClick={() => setRoomName(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </section>

        <section id="features" className="lp-panel-section" aria-labelledby="features-heading">
          <h2 id="features-heading" className="lp-head lp-panel-heading">In every room</h2>
          <ul className="lp-notes lp-notes--left" data-reveal>
            {NOTES.filter((n) => n.side === 'left').map((n) => (
              <li
                key={n.id}
                className={`lp-note ${activeNote === n.id ? 'is-active' : ''}`}
                style={{ top: n.top }}
                tabIndex={0}
                onMouseEnter={() => setActiveNote(n.id)}
                onMouseLeave={() => setActiveNote(null)}
                onFocus={() => setActiveNote(n.id)}
                onBlur={() => setActiveNote(null)}
              >
                <span className="lp-note-name">{n.name}</span>
                <span className="lp-note-text">{n.text}</span>
              </li>
            ))}
          </ul>
          <div className="lp-panel-wrap">
            <SidebarPanel active={activeNote} />
          </div>
          <ul className="lp-notes lp-notes--right" data-reveal>
            {NOTES.filter((n) => n.side === 'right').map((n) => (
              <li
                key={n.id}
                className={`lp-note ${activeNote === n.id ? 'is-active' : ''}`}
                style={{ top: n.top }}
                tabIndex={0}
                onMouseEnter={() => setActiveNote(n.id)}
                onMouseLeave={() => setActiveNote(null)}
                onFocus={() => setActiveNote(n.id)}
                onBlur={() => setActiveNote(null)}
              >
                <span className="lp-note-name">{n.name}</span>
                <span className="lp-note-text">{n.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className="lp-fields" aria-labelledby="how-heading">
          {STEPS.map((s, i) => (
            <div key={s.clause} className="lp-field">
              {i === 0 && <h2 id="how-heading" className="lp-field-heading">How a room works</h2>}
              <CardFragment step={i} />
              <p className="lp-field-clause">{s.clause}</p>
            </div>
          ))}
        </section>

        <section id="faq" className="lp-faq" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="lp-head lp-faq-heading">Questions</h2>
          <div className="lp-faq-list" data-reveal>
            {FAQS.map((f, i) => (
              <details key={f.q} className="lp-faq-item" name="faq" open={i === 0}>
                <summary>
                  {f.q}
                  <span className="lp-plus" aria-hidden="true" />
                </summary>
                <p className="lp-faq-answer">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-cta" aria-labelledby="cta-heading">
          <div className="lp-cta-copy" data-reveal>
            <h2 id="cta-heading" className="lp-cta-line">Start a<br />room</h2>
            <p className="lp-cta-sub">
              Free, in the browser, for as many people as you send the link to.
            </p>
            <button type="button" className="lp-btn lp-btn--ink lp-cta-btn" onClick={startRoom}>
              {roomName.trim() ? `Create “${roomName.trim()}”` : 'Create a room'}
            </button>
          </div>
        </section>
      </main>

      <footer className="lp-footer" data-reveal>
        <div className="lp-tile lp-tile--statement">
          <p className="lp-tile-statement">A browser IDE where a team writes, runs and talks about code in one room.</p>
          <p className="lp-tile-small">© {new Date().getFullYear()} Synapse · a student project</p>
        </div>
        <nav className="lp-tile lp-tile--nav" aria-label="Footer">
          <ul className="lp-tile-list">
            <li><Link to="/signup">Create an account</Link></li>
            <li><Link to="/login">Log in</Link></li>
            <li><Link to="/dashboard">Dashboard</Link></li>
            <li><a href="#faq">Questions</a></li>
          </ul>
        </nav>
        <div className="lp-tile lp-tile--stack">
          <p className="lp-tile-label">Built with</p>
          <p style={{ lineHeight: 1.6 }}>React, Node.js, Socket.IO, Yjs, MongoDB, Judge0 and Groq</p>
        </div>
        <div className="lp-tile lp-tile--source">
          <p className="lp-tile-label">Source code</p>
          <a className="lp-tile-source" href={REPO_URL} target="_blank" rel="noreferrer">github.com/<wbr />Adityatex/<wbr />Synapse</a>
        </div>
        <div className="lp-tile lp-tile--mark" aria-hidden="true">
          <span className="lp-wordmark">Synapse</span>
        </div>
        <Link to={primaryAction.to} className="lp-tile lp-tile--go">
          <span className="lp-go-label">{isAuthenticated ? 'Back to your rooms' : 'Start a room'}</span>
          <svg className="lp-go-arrow" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <path d="M10 30 L30 10 M14 10 H30 V26" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </footer>
    </div>
  );
}
