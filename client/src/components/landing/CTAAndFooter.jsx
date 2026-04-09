import { Link, useNavigate } from 'react-router-dom';
import { Terminal, Code2, Heart, ExternalLink } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function CTAAndFooter() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  function handleReserveRoom() {
    if (isAuthenticated) {
      navigate('/create-room');
    } else {
      navigate('/login');
    }
  }

  return (
    <>
      <section className="relative flex w-full flex-col items-center overflow-hidden px-6 pt-44 pb-36 md:px-10 lg:px-12">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[420px] w-[720px] rounded-full bg-blue-600/10 blur-[120px]" />
        </div>

        <div className="relative z-10s mx-auto flex w-full max-w-4xl flex-col items-center rounded-[30px] border border-white/[0.07] bg-white/[0.03] px-8 py-12 text-center backdrop-blur-sm md:px-12 md:py-14">
          <p className="mb-6 text-xs font-bold uppercase tracking-[0.18em] text-blue-300" style={{ marginTop: '20px' }}>Get Started Today</p>
          <h2
            className="mb-6 text-4xl font-black leading-tight text-white md:text-6xl"
            style={{ fontFamily: "'Sora', 'Inter', sans-serif", letterSpacing: '-0.04em' }}
          >
            Your team&apos;s new favorite way to code.
          </h2>
          <p className="mx-auto mb-12 w-full max-w-2xl text-center text-lg leading-8 text-gray-300" style={{ textAlign: 'center' }}>
            Stop context-switching between tabs, tools, and chat threads. Everything your team needs is already here.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-5">
            <Link
              to={isAuthenticated ? '/editor' : '/login'}
              className="inline-flex w-full items-center justify-center gap-2.5 rounded-2xl bg-blue-600 px-8 py-4 text-sm font-semibold text-white shadow-[0_0_40px_-8px_rgba(37,99,235,0.5)] transition-all duration-200 hover:-translate-y-1 hover:bg-blue-500 sm:min-w-[210px] sm:w-auto" style={{ marginTop: '30px', marginBottom: '30px' }}
            >
              <Terminal size={18} />
              Open the Editor
            </Link>
            <button
              onClick={handleReserveRoom}
              className="inline-flex w-full items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-8 py-4 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.08] sm:min-w-[210px] sm:w-auto"
            >
              Reserve a Room
            </button>
          </div>
        </div>
      </section>

      <footer className="w-full border-t border-white/[0.06] bg-black/60 backdrop-blur-sm">
        <div className="mx-auto w-full px-8 py-16 md:px-16 lg:px-20">
          <div className="flex flex-col justify-between gap-12 md:flex-row md:items-start">
            <div className="max-w-sm md:pr-8">
              <div className="mb-4 flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400" />
                <span
                  className="text-lg font-black text-white"
                  style={{ fontFamily: "'Sora', 'Inter', sans-serif", letterSpacing: '-0.04em' }}
                >
                  Synapse
                </span>
              </div>
              <p className="text-sm leading-7 text-gray-500">
                An AI-powered collaborative IDE for teams who move fast and build things that matter.
              </p>
            </div>

            <div className="md:ml-auto flex flex-wrap gap-16 text-sm md:justify-end">
              <div className="flex min-w-[160px] flex-col gap-3">
                <p className="mb-1 font-semibold text-gray-400">Product</p>
                <Link to={isAuthenticated ? '/editor' : '/login'} className="text-gray-500 transition-colors hover:text-white">Editor</Link>
                <a href="#" className="text-gray-500 transition-colors hover:text-white">Collaboration</a>
                <a href="#" className="text-gray-500 transition-colors hover:text-white">AI Assistant</a>
              </div>
              <div className="flex min-w-[160px] flex-col gap-3">
                <p className="mb-1 font-semibold text-gray-400">Open Source</p>
                <a href="#" className="flex items-center gap-1.5 text-gray-500 transition-colors hover:text-white">
                  <Code2 size={13} /> GitHub
                </a>
                <a href="#" className="flex items-center gap-1.5 text-gray-500 transition-colors hover:text-white">
                  <ExternalLink size={13} /> Documentation
                </a>
              </div>
            </div>
          </div>

          <div className="mt-14 flex flex-col gap-3 border-t border-white/[0.05] pt-8 text-xs text-gray-600 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-left">© {new Date().getFullYear()} Synapse IDE. All rights reserved.</p>
            <p className="flex items-center gap-1.5 sm:ml-auto">
              Crafted with <Heart size={11} className="text-red-400" /> by the Synapse Team
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
