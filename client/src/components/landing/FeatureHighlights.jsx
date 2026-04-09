import { Users, Code2, Sparkles, Globe } from 'lucide-react';

const FEATURE_DATA = [
  {
    title: 'Real-Time Collaboration',
    description:
      'Multiple developers, one shared canvas. See live cursor positions, edits, and selections from every teammate simultaneously.',
    icon: Users,
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    hoverBorder: 'hover:border-emerald-500/40',
    accent: 'from-emerald-500/20 to-transparent',
  },
  {
    title: 'Multi-Language Execution',
    description:
      'Write and run Python, JavaScript, C++, Java, and more, all powered by Judge0. Zero installation and instant feedback.',
    icon: Code2,
    color: 'text-sky-400',
    bg: 'bg-sky-400/10',
    hoverBorder: 'hover:border-sky-500/40',
    accent: 'from-sky-500/20 to-transparent',
  },
  {
    title: 'Built-in AI Assistant',
    description:
      'Type a question and get context-aware answers. Explain snippets, squash bugs, refactor logic, or generate entire functions with one prompt.',
    icon: Sparkles,
    color: 'text-violet-400',
    bg: 'bg-violet-400/10',
    hoverBorder: 'hover:border-violet-500/40',
    accent: 'from-violet-500/20 to-transparent',
  },
  {
    title: 'Zero-Setup IDE',
    description:
      'Open a browser tab and start shipping. No extensions, no installs, and no configuration. Your workspace is ready the moment you arrive.',
    icon: Globe,
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
    hoverBorder: 'hover:border-amber-500/40',
    accent: 'from-amber-500/20 to-transparent',
  },
];

export default function FeatureHighlights() {
  return (
    <section className="flex w-full flex-col items-center justify-center px-6 pt-40 pb-32 md:px-10 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-center">
        <div className="mx-auto mb-20 flex w-full max-w-3xl flex-col items-center justify-center text-center">
          <p className="mb-4 text-center text-xs font-bold uppercase tracking-[0.18em] text-blue-300">Platform Capabilities</p>
          <h2
            className="mb-6 w-full text-center text-3xl font-bold leading-tight text-white md:text-5xl"
            style={{ fontFamily: "'Sora', 'Inter', sans-serif", letterSpacing: '-0.03em' }}
          >
            One platform. Every tool you need.
          </h2>
          <p className="w-full text-center text-base leading-9 text-gray-300">
            Synapse cuts through toolchain complexity with a single, deeply integrated workspace built for modern teams.
          </p>
        </div>

        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 justify-items-center gap-6 md:grid-cols-2 lg:grid-cols-4">
          {FEATURE_DATA.map((feature) => (
            <div
              key={feature.title}
              className={`group relative flex w-full min-h-[250px] flex-col items-center justify-center overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.04] px-8 py-8 text-center backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:bg-white/[0.07] ${feature.hoverBorder}`}
            >
              <div
                className={`pointer-events-none absolute top-0 left-0 h-36 w-36 -translate-x-8 -translate-y-8 rounded-full bg-gradient-to-br ${feature.accent} blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
              />

              <div className={`relative z-10 mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/5 ${feature.bg} ${feature.color}`}>
                <feature.icon size={20} />
              </div>

              <h3 className="relative z-10 mb-3 w-full text-center text-lg font-bold leading-snug text-white">{feature.title}</h3>
              <p className="relative z-10 w-full max-w-[16rem] text-center text-sm leading-7 text-gray-300">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
