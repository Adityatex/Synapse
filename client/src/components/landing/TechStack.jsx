export default function TechStack() {
  const STACK = [
    { name: 'React', label: 'Frontend Framework' },
    { name: 'Monaco Editor', label: 'Code Editor Layer' },
    { name: 'Socket.IO', label: 'Real-time Sync' },
    { name: 'Judge0 API', label: 'Execution Engine' },
    { name: 'Node.js', label: 'Backend Server' },
    { name: 'OpenAI API', label: 'AI Intelligence' },
  ];

  return (
    <section className="flex w-full flex-col items-center overflow-hidden px-6 pt-36 pb-28 md:px-10 lg:px-12">
      <div className="w-full max-w-5xl">
        <p className="mb-14 text-center text-xs font-bold uppercase tracking-[0.18em] text-gray-500" style={{ marginBottom: "20px" }}>
          Trusted Technologies Under the Hood
        </p>

        <div className="flex w-full flex-wrap justify-center gap-4">
          {STACK.map((tech) => (
            <div
              key={tech.name}
              className="group flex min-h-[80px] min-w-[145px] flex-col items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03] px-5 py-4 transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.06]"
            >
              <span className="mb-2 text-sm font-bold tracking-tight text-gray-300 transition-colors group-hover:text-white">
                {tech.name}
              </span>
              <span className="text-center text-[11px] leading-5 text-gray-500 transition-colors group-hover:text-gray-400">
                {tech.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
