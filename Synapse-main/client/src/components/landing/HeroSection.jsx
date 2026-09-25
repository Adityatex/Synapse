import { Link, useNavigate } from 'react-router-dom';
import { Terminal, Users } from 'lucide-react';
import { useAuth } from '../../context/useAuth';

export default function HeroSection() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  function handleCreateRoom() {
    if (isAuthenticated) {
      navigate('/create-room');
    } else {
      navigate('/login');
    }
  }

  return (
    <section className="relative flex w-full flex-col items-center overflow-hidden px-6 pb-36 pt-20 md:px-10 md:pb-44 md:pt-28 lg:px-12">
      <div className="absolute left-1/2 top-0 -z-10 h-[500px] w-[920px] -translate-x-1/2 rounded-full bg-blue-600/15 blur-[150px]" />

      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-16 text-center lg:gap-15">
        <div className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.06] px-5 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-300 shadow-[0_12px_40px_-22px_rgba(59,130,246,0.8)]" style={{ marginTop: '40px' }}>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
          </span>
          Now in Early Access
        </div>

        <div className="flex w-full flex-col items-center gap-10">
          <div className="mx-auto flex w-full max-w-4xl flex-col items-center">
            <h1
              className="mb-7 w-full text-4xl font-black leading-[1.02] tracking-tighter text-white sm:text-5xl md:text-6xl lg:text-[72px]"
              style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}
            >
              Code Together.
              <br />
              <span className="bg-gradient-to-r from-blue-300 via-cyan-300 to-blue-500 bg-clip-text text-transparent">
                Build Faster.
              </span>
              <br />
              Think Smarter with AI.
            </h1>

            <p className="mx-auto mb-10 w-full max-w-2xl text-center text-base font-normal leading-8 text-gray-300 md:text-lg" style={{ textAlign: 'center' }}>
              A browser-based collaborative IDE with real-time editing, multi-language execution, and an AI assistant that actually understands your code.
            </p>

            <div className="flex w-full flex-col items-center justify-center gap-4 sm:flex-row sm:gap-5" style={{ marginTop: '15px', marginBottom: '15px' }}>
              <Link
                to={isAuthenticated ? '/editor' : '/login'}
                className="inline-flex w-full items-center justify-center gap-2.5 rounded-2xl bg-blue-600 px-8 py-4 text-sm font-semibold text-white shadow-[0_0_40px_-8px_rgba(37,99,235,0.5)] transition-all duration-200 hover:-translate-y-1 hover:bg-blue-500 hover:shadow-[0_0_50px_-5px_rgba(37,99,235,0.65)] sm:min-w-[210px] sm:w-auto"
              >
                <Terminal size={18} />
                Open the Editor
              </Link>

              <button
                onClick={handleCreateRoom}
                className="group relative inline-flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl border border-white/12 bg-white/[0.04] px-8 py-4 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.08] sm:min-w-[210px] sm:w-auto"
              >
                <Users size={18} className="text-gray-300 transition-colors group-hover:text-cyan-300" />
                Create a Room
                <span className="absolute right-3 top-3 flex h-[7px] w-[7px]">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                  <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-cyan-400" />
                </span>
              </button>
            </div>

            <p className="mt-8 text-xs tracking-[0.2em] text-gray-500">
              No credit card required · No local setup · All languages supported
            </p>
          </div>

          <div className="w-full max-w-5xl">
            <div className="relative mx-auto overflow-hidden rounded-[28px] border border-white/10 bg-[#09111e]/80 p-4 shadow-[0_40px_100px_-35px_rgba(8,15,28,1)] backdrop-blur-xl">
              <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
              <div className="grid gap-0 overflow-hidden rounded-[22px] border border-white/6 bg-[#050913]/95 lg:grid-cols-[1fr_1fr]">
                <div className="border-b border-white/6 p-8 sm:p-10 lg:border-b-0 lg:border-r">
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-rose-400/90" />
                      <span className="h-3 w-3 rounded-full bg-amber-400/90" />
                      <span className="h-3 w-3 rounded-full bg-emerald-400/90" />
                    </div>
                    <div className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">
                      room / pair-session.tsx
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/6 bg-[#0c1424] p-7 text-left shadow-inner shadow-black/20">
                    <div className="mb-4 flex items-center gap-3 text-xs text-gray-400">
                      <span className="rounded-full bg-blue-500/12 px-3 py-1 font-semibold text-blue-300">Live session</span>
                      <span>2 collaborators typing</span>
                    </div>
                    <pre className="overflow-x-auto text-[12px] leading-7 text-gray-300 sm:text-sm">
                      {`export async function shipFeature(room, agent) {
  const draft = await room.syncChanges();
  const review = await agent.review(draft);

  return room.commit({
    summary: review.summary,
    suggestions: review.actions,
  });
}`}
                    </pre>
                  </div>
                </div>

                <div className="flex flex-col justify-between p-8 sm:p-10">
                  <div className="space-y-5 text-left">
                    <div className="rounded-2xl border border-cyan-400/12 bg-cyan-400/[0.05] p-7">
                      <p className="mb-2 text-sm font-semibold text-white">Presence that feels instant</p>
                      <p className="text-sm leading-7 text-gray-300">
                        Shared cursors, synced files, and execution results stay lined up so your team can move as one.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-7">
                      <p className="mb-2 text-sm font-semibold text-white">AI that understands the session</p>
                      <p className="text-sm leading-7 text-gray-300">
                        Ask questions in-context and get answers grounded in the code already open in the room.
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 text-left">
                      <p className="text-2xl font-bold text-white">50ms</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-gray-500">Realtime sync target</p>
                    </div>
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 text-left">
                      <p className="text-2xl font-bold text-white">1 tab</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-gray-500">Code, run, collaborate</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
