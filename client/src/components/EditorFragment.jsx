import { useEffect, useRef, useState } from 'react';

// A true-to-size piece of the room editor: one file, two people's cursors,
// and the output of running it. The program and its output are real.
//
// live:        Riya types the last line, the room runs it, the output
//              appears, then it starts over (paused off screen; the finished
//              state is shown when the visitor prefers reduced motion).
// interactive: the visitor can click in and type; they join as a third
//              cursor ("You") and their text lands as a comment on line 7.

const PEERS = {
  riya: { name: 'Riya', bg: '#f6e016', ink: '#0d2a1c', bar: '#b89c00' },
  arjun: { name: 'Arjun', bg: '#7dd3fc', ink: '#062433', bar: '#0284c7' },
  you: { name: 'You', bg: '#0d2a1c', ink: '#ffffff', bar: '#0d2a1c' },
};

const PRINT_LINE = 'print(two_sum([2, 7, 11, 15], 9))';
const TYPE_MS = 70;
const RUN_DELAY_MS = 700;
const RUNNING_MS = 650;
const HOLD_MS = 3600;

function Caret({ peer, blink = false }) {
  const p = PEERS[peer];
  return (
    <span className={`frag-caret ${blink ? 'frag-caret--blink' : ''}`} style={{ background: p.bar }} aria-hidden="true">
      <span className="frag-caret-label" style={{ background: p.bg, color: p.ink }}>
        {p.name}
      </span>
    </span>
  );
}

// Highlight the (partly typed) print line the way the editor would.
function highlightPrint(text) {
  const out = [];
  const re = /(print|two_sum)|(\d+)|([^\w]+|\w+)/g;
  let m;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m[1]) out.push(<span key={k++} className="frag-fn">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className="frag-num">{m[2]}</span>);
    else out.push(m[3]);
  }
  return out;
}

const STATIC_LINES = [
  [<span key="k" className="frag-kw">def </span>, <span key="f" className="frag-fn">two_sum</span>, '(nums, target):'],
  ['    seen = {}'],
  ['    ', <span key="k" className="frag-kw">for</span>, ' i, n ', <span key="k2" className="frag-kw">in</span>, ' ', <span key="f" className="frag-fn">enumerate</span>, '(nums):'],
  ['        ', <span key="k" className="frag-kw">if</span>, ' target - n ', <span key="k2" className="frag-kw">in</span>, ' seen:'],
  ['            ', <span key="k" className="frag-kw">return</span>, ' [seen[target - n], i]'],
  ['        ', <span key="s" className="frag-sel">seen[n] = i</span>, <Caret key="c" peer="arjun" />],
];

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function EditorFragment({ className = '', live = false, interactive = false }) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  // typed = characters of the print line; phase = typing | waiting | running | done
  const [typed, setTyped] = useState(live ? 0 : PRINT_LINE.length);
  const [phase, setPhase] = useState(live ? 'typing' : 'done');
  const [visible, setVisible] = useState(false);
  const [you, setYou] = useState('');
  const [youHere, setYouHere] = useState(false);
  const [youFocused, setYouFocused] = useState(false);
  const reduced = live && prefersReducedMotion();
  const animating = live && !reduced;

  // Only run the loop while the fragment is on screen.
  useEffect(() => {
    if (!animating || !rootRef.current || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.3 });
    io.observe(rootRef.current);
    return () => io.disconnect();
  }, [animating]);

  useEffect(() => {
    if (!animating || !visible) return undefined;
    let timer;
    if (phase === 'typing') {
      timer = window.setTimeout(() => {
        if (typed < PRINT_LINE.length) setTyped(typed + 1);
        else setPhase('waiting');
      }, TYPE_MS + (PRINT_LINE[typed] === ' ' ? 40 : 0));
    } else if (phase === 'waiting') {
      timer = window.setTimeout(() => setPhase('running'), RUN_DELAY_MS);
    } else if (phase === 'running') {
      timer = window.setTimeout(() => setPhase('done'), RUNNING_MS);
    } else if (phase === 'done') {
      timer = window.setTimeout(() => {
        setTyped(0);
        setPhase('typing');
      }, HOLD_MS);
    }
    return () => window.clearTimeout(timer);
  }, [animating, visible, phase, typed]);

  const shownTyped = reduced ? PRINT_LINE.length : typed;
  const shownPhase = reduced ? 'done' : phase;
  const people = 2 + (youHere ? 1 : 0);

  const lines = [
    ...STATIC_LINES,
    // line 7: the visitor's line
    interactive && (youHere || you)
      ? [
          you ? <span key="cm" className="frag-cm">{`# ${you}`}</span> : '',
          youFocused ? <Caret key="y" peer="you" blink /> : null,
        ]
      : [''],
    // line 8: Riya types it
    [
      ...highlightPrint(PRINT_LINE.slice(0, shownTyped)),
      shownPhase === 'typing' || shownPhase === 'waiting' ? <Caret key="r" peer="riya" /> : null,
    ],
  ];

  const output =
    shownPhase === 'done' ? (
      <code className="frag-output-value">[0, 1]</code>
    ) : shownPhase === 'running' ? (
      <span className="frag-output-running">Running…</span>
    ) : (
      <span className="frag-output-running">Riya is typing…</span>
    );

  return (
    <div
      ref={rootRef}
      className={`frag ${interactive ? 'frag--interactive' : ''} ${className}`}
      data-ui
      role={interactive ? 'group' : 'img'}
      aria-label="Two people editing two_sum.py in a Synapse room; running it prints [0, 1]"
      onClick={() => interactive && inputRef.current?.focus()}
    >
      <div className="frag-tabs">
        <span className="frag-tab frag-tab--active">two_sum.py</span>
        <span className="frag-tab">notes.md</span>
        <span className="frag-peers">
          <span className="frag-avatar" style={{ background: PEERS.riya.bg, color: PEERS.riya.ink }}>R</span>
          <span className="frag-avatar" style={{ background: PEERS.arjun.bg, color: PEERS.arjun.ink }}>A</span>
          {youHere && <span className="frag-avatar" style={{ background: PEERS.you.bg, color: PEERS.you.ink }}>Y</span>}
          {people} in this room
        </span>
      </div>
      <pre className="frag-code">
        <code>
          {lines.map((parts, i) => (
            <span key={i} className={`frag-line ${i === 7 && shownPhase !== 'done' ? 'frag-line--active' : ''}`}>
              <span className="frag-ln">{i + 1}</span>
              <span>{parts}</span>
            </span>
          ))}
        </code>
      </pre>
      <div className="frag-output">
        <span className="frag-output-label">Output</span>
        {output}
      </div>
      {interactive && (
        <>
          <label className="sr-only" htmlFor="frag-you">Type a comment into the demo file</label>
          <input
            id="frag-you"
            ref={inputRef}
            className="frag-you-input"
            value={you}
            maxLength={36}
            autoComplete="off"
            spellCheck={false}
            onFocus={() => {
              setYouHere(true);
              setYouFocused(true);
            }}
            onBlur={() => setYouFocused(false)}
            onChange={(e) => setYou(e.target.value.replace(/[\r\n]/g, ''))}
          />
          {!you && <span className="frag-hint">{youFocused ? 'Type something. You’re in the file.' : 'Click to type in this file'}</span>}
        </>
      )}
    </div>
  );
}
