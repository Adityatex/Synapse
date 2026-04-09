import { Network, UserPlus, Zap } from 'lucide-react';

const STEPS = [
  {

    title: 'Open a Session',
    description:
      'Spin up a new workspace in seconds. Every session gets a unique, secure link you can share with anyone instantly.',
    icon: Network,
    gradient: 'from-blue-500 to-cyan-400',
    shadow: 'shadow-blue-900/30',
  },
  {
    title: 'Invite Your Team',
    description:
      'Paste the link in Slack, Discord, or email. Collaborators join without creating accounts or cloning a repo.',
    icon: UserPlus,
    gradient: 'from-violet-500 to-fuchsia-500',
    shadow: 'shadow-violet-900/30',
  },
  {
    title: 'Ship with AI Superpowers',
    description:
      'Write, run, and debug side-by-side with teammates while the built-in AI handles explanations, fixes, and refactors.',
    icon: Zap,
    gradient: 'from-amber-400 to-orange-500',
    shadow: 'shadow-orange-900/30',
  },
];

export default function HowItWorks() {
  return (
    <section
      className="flex w-full flex-col px-6 pt-40 pb-32 md:px-10 lg:px-12"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', overflow: 'hidden' }}
    >
      <div className="w-full max-w-7xl" style={{ margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        <div style={{ margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '20px', maxWidth: '800px' }}>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300" style={{ marginBottom: '10px' }}>
            Getting Started
          </p>
          <h2
            className="text-3xl font-bold leading-tight text-white md:text-5xl"
            style={{ fontFamily: "'Sora', 'Inter', sans-serif", letterSpacing: '-0.03em', marginBottom: '10px' }}
          >
            Up and running in three steps.
          </h2>
          <p className="text-base leading-8 text-gray-300" style={{ marginBottom: '20px' }}>
            No lengthy onboarding. No sprawling docs. Just open, share, and code.
          </p>
        </div>

        <div className="relative w-full max-w-6xl" style={{ margin: '0 auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '64px' }}>
          <div className="pointer-events-none absolute top-10 left-[calc(16.7%+2rem)] right-[calc(16.7%+2rem)] z-0 hidden h-px bg-gradient-to-r from-transparent via-white/10 to-transparent md:block" />

          {STEPS.map((step, index) => (
            <div
              key={index}
              className="group relative z-10 flex flex-col items-center rounded-[26px] border border-white/[0.07] bg-white/[0.03] px-8 py-12 text-center backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:border-white/[0.12] hover:bg-white/[0.05]"
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 1 300px', maxWidth: '400px' }}
            >
              <div className={`relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br shadow-xl transition-transform duration-500 group-hover:-translate-y-2 group-hover:scale-105 ${step.gradient} ${step.shadow}`} style={{ marginTop: '20px', marginBottom: '10px' }}>
                <step.icon size={22} className="text-white backdrop-blur-sm" />
              </div>

              <h3 className="text-xl font-bold text-white" style={{ fontFamily: "'Sora', 'Inter', sans-serif", marginBottom: '10px' }}>
                {step.title}
              </h3>
              <p className="text-sm leading-8 text-gray-300" style={{ margin: '0 auto', marginBottom: '20px', maxWidth: '300px' }}>{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
