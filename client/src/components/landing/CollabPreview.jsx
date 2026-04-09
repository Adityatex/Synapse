export default function CollabPreview() {
  return (
    <section className="flex w-full flex-col items-center justify-center px-6 pt-40 pb-32 md:px-10 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-center">
        <div className="mx-auto mb-20 flex w-full max-w-3xl flex-col items-center justify-center text-center">
          <p className="mb-4 w-full text-center text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">Live Preview</p>
          <h2
            className="mb-6 w-full text-center text-3xl font-bold leading-tight text-white md:text-5xl"
            style={{ fontFamily: "'Sora', 'Inter', sans-serif", letterSpacing: '-0.03em' }}
          >
            Google Docs, but for your codebase.
          </h2>
          <p className="w-full text-center text-base leading-8 text-gray-300">
            Everyone sees the same file, in real time. No merge conflicts, no waiting, and no stale branches.
          </p>
        </div>

        <div className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/10 bg-[#0a1019]/85 shadow-[0_34px_90px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <div className="flex items-center gap-6 border-b border-white/[0.06] bg-[#161b22] px-6 py-4">
            <div className="flex gap-2">
              <div className="h-3 w-3 rounded-full bg-red-500/80" />
              <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
              <div className="h-3 w-3 rounded-full bg-green-500/80" />
            </div>
            <div className="mx-auto rounded-md bg-black/30 px-4 py-1 text-[11px] font-mono tracking-wide text-gray-500">
              server.js - Synapse Room #A1B2 · 2 collaborators
            </div>
            <div className="flex gap-1.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#161b22] bg-blue-500 text-[9px] font-bold text-white">A</div>
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#161b22] bg-purple-500 text-[9px] font-bold text-white">B</div>
            </div>
          </div>

          <div className="flex h-[440px] overflow-hidden bg-[#0d1117] font-mono text-sm leading-7">
            <div className="hidden w-48 flex-shrink-0 flex-col gap-2 border-r border-white/[0.06] bg-[#010409] px-5 py-6 sm:flex md:w-56">
              <span className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">Explorer</span>
              <div className="cursor-pointer rounded-lg bg-blue-500/[0.12] px-3 py-2 text-xs text-blue-400">server.js</div>
              <div className="cursor-pointer rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-white/[0.03] hover:text-gray-300">index.html</div>
              <div className="cursor-pointer rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-white/[0.03] hover:text-gray-300">styles.css</div>
            </div>

            <div className="relative flex-1 overflow-hidden px-8 py-8 md:px-10">
              <div className="absolute top-[84px] left-[256px] z-10 animate-pulse">
                <div className="relative h-[18px] w-0.5 bg-blue-500">
                  <div className="absolute -top-6 left-0 whitespace-nowrap rounded bg-blue-600 px-2 py-0.5 font-sans text-[10px] text-white shadow-md">
                    Alice
                  </div>
                </div>
              </div>
              <div className="absolute top-[140px] left-[178px] z-10" style={{ animation: 'pulse 2.5s ease-in-out infinite' }}>
                <div className="relative h-[18px] w-0.5 bg-purple-500">
                  <div className="absolute -top-6 left-0 whitespace-nowrap rounded bg-purple-600 px-2 py-0.5 font-sans text-[10px] text-white shadow-md">
                    Bob
                  </div>
                </div>
              </div>

              <pre className="whitespace-pre-wrap text-[12px] leading-7 text-gray-300 outline-none md:text-[13px]">
                <span className="text-pink-400">const</span> express = <span className="text-sky-300">require</span>(<span className="text-amber-300">'express'</span>);
                <span className="text-pink-400">const</span> app = <span className="text-sky-300">express</span>();
                <span className="text-pink-400">const</span> port = <span className="text-green-400">3000</span>;

                app.<span className="text-sky-300">get</span>(<span className="text-amber-300">'/'</span>, (req, res) <span className="text-pink-400">=&gt;</span> {'{'}
                <span className="text-pink-400">  return</span> res.<span className="text-sky-300">json</span>({'{'}
                message: <span className="text-amber-300">'Hello, Collaborative World!'</span>,
                status: <span className="text-amber-300">'success'</span>
                {'}'});
                {'}'});

                app.<span className="text-sky-300">listen</span>(port, () <span className="text-pink-400">=&gt;</span> {'{'}
                console.<span className="text-sky-300">log</span>(<span className="text-amber-300">{"`"}Server live on port {'${port}'}{"`"}</span>);
                {'}'});
              </pre>
            </div>

            <div className="hidden w-[18rem] flex-shrink-0 flex-col gap-4 border-l border-white/[0.06] bg-[#0a0d14] px-6 py-7 lg:flex">
              <div className="flex items-center gap-2 border-b border-white/[0.06] pb-4">
                <div className="h-2 w-2 animate-pulse rounded-full bg-purple-400" />
                <span className="text-xs font-semibold text-purple-300">Synapse AI</span>
              </div>
              <div className="rounded-2xl border border-purple-500/[0.15] bg-purple-500/[0.08] p-5 text-[12px] leading-6 text-gray-300">
                <span className="mb-2 block font-bold text-purple-400">Suggestion</span>
                Standard Express setup detected. Want me to scaffold a Dockerfile and <code className="text-sky-300">.env</code> template?
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 text-[12px] leading-6 text-gray-400">
                AI can explain diffs, suggest test cases, and generate follow-up tasks for the room.
              </div>
              <div className="mt-auto flex h-11 items-center rounded-xl border border-white/[0.07] bg-black/40 px-4">
                <span className="text-[11px] text-gray-600">Ask AI...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
