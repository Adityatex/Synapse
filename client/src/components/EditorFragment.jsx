// A static, true-to-size piece of the room editor: one file, two people's
// cursors, and the output of running it. Used where the product explains
// itself (auth pages, landing page). The program and its output are real.

const PEERS = {
  riya: { name: 'Riya', bg: '#f6e016', ink: '#0d2a1c' },
  arjun: { name: 'Arjun', bg: '#7dd3fc', ink: '#062433' },
};

function Caret({ peer }) {
  const p = PEERS[peer];
  return (
    <span className="frag-caret" style={{ background: p.bg }} aria-hidden="true">
      <span className="frag-caret-label" style={{ background: p.bg, color: p.ink }}>
        {p.name}
      </span>
    </span>
  );
}

const LINES = [
  [<span key="k" className="frag-kw">def </span>, <span key="f" className="frag-fn">two_sum</span>, '(nums, target):'],
  ['    seen = {}'],
  ['    ', <span key="k" className="frag-kw">for</span>, ' i, n ', <span key="k2" className="frag-kw">in</span>, ' ', <span key="f" className="frag-fn">enumerate</span>, '(nums):'],
  ['        ', <span key="k" className="frag-kw">if</span>, ' target - n ', <span key="k2" className="frag-kw">in</span>, ' seen:', <Caret key="c" peer="riya" />],
  ['            ', <span key="k" className="frag-kw">return</span>, ' [seen[target - n], i]'],
  ['        ', <span key="s" className="frag-sel">seen[n] = i</span>, <Caret key="c" peer="arjun" />],
  [''],
  [<span key="f" className="frag-fn">print</span>, '(two_sum([', <span key="n" className="frag-num">2</span>, ', ', <span key="n2" className="frag-num">7</span>, ', ', <span key="n3" className="frag-num">11</span>, ', ', <span key="n4" className="frag-num">15</span>, '], ', <span key="n5" className="frag-num">9</span>, '))'],
];

export default function EditorFragment({ className = '' }) {
  return (
    <div className={`frag ${className}`} data-ui role="img" aria-label="Two people editing two_sum.py in a Synapse room; running it prints [0, 1]">
      <div className="frag-tabs">
        <span className="frag-tab frag-tab--active">two_sum.py</span>
        <span className="frag-tab">notes.md</span>
        <span className="frag-peers">
          <span className="frag-avatar" style={{ background: PEERS.riya.bg, color: PEERS.riya.ink }}>R</span>
          <span className="frag-avatar" style={{ background: PEERS.arjun.bg, color: PEERS.arjun.ink }}>A</span>
          2 in this room
        </span>
      </div>
      <pre className="frag-code">
        <code>
          {LINES.map((parts, i) => (
            <span key={i} className={`frag-line ${i === 3 ? 'frag-line--active' : ''}`}>
              <span className="frag-ln">{i + 1}</span>
              <span>{parts}</span>
            </span>
          ))}
        </code>
      </pre>
      <div className="frag-output">
        <span className="frag-output-label">Output</span>
        <code className="frag-output-value">[0, 1]</code>
      </div>
    </div>
  );
}
