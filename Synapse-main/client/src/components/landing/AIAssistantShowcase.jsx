import { MessageSquareCode, Bug, Wand2, RefreshCw, Layers } from 'lucide-react';

const AI_FEATURES = [
  { icon: MessageSquareCode, label: 'Explain any snippet in plain English' },
  { icon: Bug, label: 'Identify and fix bugs automatically' },
  { icon: Wand2, label: 'Optimize logic for speed and clarity' },
  { icon: RefreshCw, label: 'Translate code between languages' },
  { icon: Layers, label: 'Generate functions from a description' },
];

export default function AIAssistantShowcase() {
  return (
    <section className="relative flex w-full flex-col items-center overflow-hidden px-6 pt-40 pb-28 md:px-10 lg:px-12">
      <div className="pointer-events-none absolute right-[-100px] top-1/2 h-[500px] w-[500px] -translate-y-1/2 rounded-full bg-purple-600/10 blur-[130px]" />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center gap-16 lg:flex-row lg:items-stretch lg:gap-14">
        <div className="flex flex-1 rounded-[28px] border border-white/[0.07] bg-white/[0.03] p-8 text-center backdrop-blur-sm lg:p-10 lg:text-left">
          <div className="my-auto">
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em] text-purple-300">AI-Powered</p>
            <h2
              className="mb-6 text-3xl font-bold leading-tight text-white md:text-5xl"
              style={{ fontFamily: "'Sora', 'Inter', sans-serif", letterSpacing: '-0.03em' }}
            >
              Your Built-In{' '}
              <span className="bg-gradient-to-r from-purple-300 to-fuchsia-400 bg-clip-text text-transparent">
                Coding Partner
              </span>
            </h2>
            <p className="mb-10 max-w-xl text-base leading-8 text-gray-300 lg:mx-0">
              Synapse AI is woven directly into your editor. It reads your code, understands context, and gives you precise answers without copy-pasting into a separate chat window.
            </p>

            <ul className="inline-block w-full max-w-md space-y-4 text-left lg:max-w-none">
              {AI_FEATURES.map((feat) => (
                <li key={feat.label} className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-4 text-gray-300">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-500/10 text-purple-400">
                    <feat.icon size={18} />
                  </div>
                  <span className="text-sm font-medium leading-relaxed">{feat.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="relative w-full max-w-lg flex-1">
          <div className="pointer-events-none absolute -inset-px rounded-[28px] bg-gradient-to-br from-purple-500/30 to-blue-500/10 opacity-60 blur-sm" />

          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0f1119] shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/[0.07] bg-white/[0.02] px-6 py-5">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-purple-500/20">
                <Wand2 size={15} className="text-purple-400" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-none text-white">Synapse AI</p>
                <p className="mt-1 text-[11px] text-emerald-400">Live on this file</p>
              </div>
            </div>

            <div className="flex flex-col gap-5 p-6 text-sm">
              <div className="self-end max-w-[85%] rounded-2xl rounded-tr-sm border border-white/[0.08] bg-white/[0.06] px-5 py-4 leading-7 text-gray-300">
                What does the <code className="rounded bg-blue-500/10 px-1.5 py-0.5 text-xs text-blue-300">reduce()</code> call on line 42 do?
              </div>

              <div className="self-start max-w-[90%] rounded-2xl rounded-tl-sm border border-purple-500/[0.15] bg-purple-500/[0.08] px-5 py-4 leading-7 text-gray-300">
                It folds the <span className="font-medium text-purple-300">prices</span> array into a running total. Each iteration adds the current price to an accumulator, ultimately returning the cart&apos;s grand total.
                <br />
                <br />
                Want me to rewrite it with a <span className="font-medium text-purple-300">for...of</span> loop for clarity?
              </div>

              <div className="self-end max-w-[85%] rounded-2xl rounded-tr-sm border border-white/[0.08] bg-white/[0.06] px-5 py-4 leading-7 text-gray-300">
                Yes, and flag any edge cases.
              </div>

              <div className="self-start max-w-[90%] rounded-2xl rounded-tl-sm border border-purple-500/[0.15] bg-purple-500/[0.08] px-5 py-4 leading-7 text-gray-300">
                <pre className="mb-3 overflow-x-auto rounded-xl bg-black/40 p-4 font-mono text-xs leading-5 text-purple-200">
{`let total = 0;
for (const price of prices) {
  if (typeof price !== 'number') continue;
  total += price;
}`}
                </pre>
                <span className="font-medium text-amber-300">Warning:</span> non-numeric values are silently skipped. Consider throwing an error instead if data integrity matters.
              </div>
            </div>

            <div className="px-6 pb-6">
              <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-4 text-sm text-gray-500">
                <span>Ask about this file...</span>
                <kbd className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-600">Ctrl K</kbd>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
