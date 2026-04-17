import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ChevronRight,
  Code2,
  Cpu,
  GitBranch,
  LayoutDashboard,
  Layers,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users2,
  UserRound,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { getAvatarStyle, getUserInitial } from '../utils/avatar';
import SynapseLogo from '../components/SynapseLogo';

class BackgroundParticle {
  constructor(canvas) {
    this.canvas = canvas;
    this.reset();
  }

  reset() {
    this.x = Math.random() * this.canvas.width;
    this.y = Math.random() * this.canvas.height;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = (Math.random() - 0.5) * 0.5;
    this.radius = Math.random() * 2 + 1;
    this.color = Math.random() > 0.5 ? '#6366f1' : '#a855f7';
    this.pulse = Math.random() * Math.PI;
  }

  update(mouseRef) {
    this.x += this.vx;
    this.y += this.vy;
    this.pulse += 0.01;

    if (mouseRef.current.active) {
      const dx = mouseRef.current.x - this.x;
      const dy = mouseRef.current.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 300) {
        const force = (300 - distance) / 3000;
        this.vx += dx * force * 0.05;
        this.vy += dy * force * 0.05;
      }
    }

    this.vx *= 0.98;
    this.vy *= 0.98;

    if (this.x < 0) this.x = this.canvas.width;
    if (this.x > this.canvas.width) this.x = 0;
    if (this.y < 0) this.y = this.canvas.height;
    if (this.y > this.canvas.height) this.y = 0;
  }

  draw(context) {
    const opacity = 0.4 + Math.sin(this.pulse) * 0.2;

    context.beginPath();
    context.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    context.fillStyle = this.color;
    context.globalAlpha = opacity;
    context.shadowBlur = 10;
    context.shadowColor = this.color;
    context.fill();
    context.globalAlpha = 1;
  }
}

function MedusaeBackground() {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: -1000, y: -1000, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    let animationFrameId;
    let particles = [];
    const particleCount = 80;
    const connectionDistance = 200;
    let disposed = false;

    const initializeCanvas = () => {
      if (disposed) {
        return;
      }

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      particles = Array.from({ length: particleCount }, () => new BackgroundParticle(canvas));
    };

    const drawConnections = () => {
      context.shadowBlur = 0;

      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const particleA = particles[i];
          const particleB = particles[j];
          const dx = particleA.x - particleB.x;
          const dy = particleA.y - particleB.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < connectionDistance) {
            const opacity = (1 - distance / connectionDistance) * 0.3;
            let mouseBonus = 0;

            if (mouseRef.current.active) {
              const midX = (particleA.x + particleB.x) / 2;
              const midY = (particleA.y + particleB.y) / 2;
              const mouseDx = midX - mouseRef.current.x;
              const mouseDy = midY - mouseRef.current.y;
              const mouseDistance = Math.sqrt(mouseDx * mouseDx + mouseDy * mouseDy);

              if (mouseDistance < 250) {
                mouseBonus = (1 - mouseDistance / 250) * 0.3;
              }
            }

            context.beginPath();
            context.moveTo(particleA.x, particleA.y);

            const midX = (particleA.x + particleB.x) / 2;
            const midY = (particleA.y + particleB.y) / 2;

            context.quadraticCurveTo(midX + 10, midY + 10, particleB.x, particleB.y);
            context.strokeStyle = particleA.color;
            context.lineWidth = (1 - distance / connectionDistance) * 1.2 + mouseBonus;
            context.globalAlpha = opacity + mouseBonus;
            context.stroke();
            context.globalAlpha = 1;
          }
        }
      }
    };

    const animate = () => {
      if (disposed) {
        return;
      }

      context.fillStyle = '#05070d';
      context.globalAlpha = 0.15;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = 1;

      particles.forEach((particle) => {
        particle.update(mouseRef);
        particle.draw(context);
      });

      drawConnections();
      animationFrameId = window.requestAnimationFrame(animate);
    };

    const handleMouseMove = (event) => {
      // The canvas is fixed to the viewport, so pointer tracking must stay in viewport coordinates too.
      mouseRef.current = { x: event.clientX, y: event.clientY, active: true };
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };

    const handleResize = () => {
      initializeCanvas();
    };

    initializeCanvas();
    animate();

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-0 bg-[#05070d]">
      <canvas ref={canvasRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.12),transparent_35%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.1),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_0%,#05070d_85%)]" />
    </div>
  );
}

function NavItem({ href, children }) {
  return (
    <a
      href={href}
      className="group relative py-1 text-sm font-semibold text-slate-400 transition-colors duration-300 hover:text-white"
    >
      {children}
      <span className="absolute bottom-0 left-0 h-px w-0 bg-indigo-500 transition-all duration-300 group-hover:w-full" />
    </a>
  );
}

function getDisplayName(user) {
  if (!user) {
    return 'Log in';
  }

  return user.name || user.username || user.fullName || user.email?.split('@')[0] || 'Account';
}

const collaborationHighlights = [
  {
    icon: Users2,
    title: 'Instant shared workspaces',
    description:
      'Create a room, invite teammates, and collaborate with live sync from any browser.',
  },
  {
    icon: Layers,
    title: 'One loop for code, review, and run',
    description:
      'Edit together, review changes live, and run code without switching tools.',
  },
  {
    icon: Cpu,
    title: 'AI support for faster delivery',
    description:
      'Use built-in AI to explain logic, catch issues early, and ship with confidence.',
  },
];

const trustStats = [
  { value: '<20ms', label: 'collaboration sync', detail: 'Fast room presence and shared edits.' },
  { value: '12+', label: 'languages ready', detail: 'Run code across common interview and project stacks.' },
  { value: '24/7', label: 'workspace access', detail: 'Join sessions instantly from the browser.' },
  { value: 'AI-native', label: 'review workflow', detail: 'Get context-aware assistance without leaving the IDE.' },
];

const useCases = [
  {
    icon: Terminal,
    title: 'Interview Practice',
    description: 'Run live interviews and pair sessions in a ready-to-code browser workspace.',
  },
  {
    icon: GitBranch,
    title: 'Team Pairing',
    description: 'Resolve bugs, review code, and make decisions together in one place.',
  },
  {
    icon: ShieldCheck,
    title: 'Classrooms And Labs',
    description: 'Give students one browser workspace for coding, execution, and guided AI help.',
  },
];

const testimonials = [
  {
    quote:
      'Synapse removed setup overhead. We moved from screen-sharing to true collaboration.',
    name: 'Riya Sharma',
    role: 'Engineering Lead, BuildLab',
  },
  {
    quote:
      'The AI feels native to the editor and helps us review faster without breaking flow.',
    name: 'Aditya Mehta',
    role: 'Product Engineer, SprintForge',
  },
  {
    quote:
      'For mentoring and demos, sending one room link is much easier than fixing local setups.',
    name: 'Neha Verma',
    role: 'Instructor, CodeCircle',
  },
];

const faqItems = [
  {
    question: 'Do users need to install anything before joining?',
    answer: 'No. Synapse is browser-first, so users can join and start coding immediately.',
  },
  {
    question: 'Is this useful only for teams?',
    answer: 'No. It works for interviews, classrooms, mentoring sessions, and solo work too.',
  },
  {
    question: 'What makes the AI experience different?',
    answer: 'The assistant lives inside the editor, so you can ask in context while coding.',
  },
];

const footerGroups = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'Preview', href: '#preview' },
      { label: 'Use Cases', href: '#use-cases' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Docs', href: '#workflow' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Status', href: '#status' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Privacy', href: '#footer' },
      { label: 'Terms', href: '#footer' },
      { label: 'Security', href: '#footer' },
    ],
  },
];

export default function LandingPage() {
  const [isScrolled, setIsScrolled] = useState(false);
  const { isAuthenticated, user, logout } = useAuth();
  const displayName = getDisplayName(user);
  const userAvatarStyle = getAvatarStyle(user);

  useEffect(() => {
    document.body.style.backgroundColor = '#05070d';

    return () => {
      document.body.style.backgroundColor = '';
    };
  }, []);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#05070d] text-slate-200 selection:bg-indigo-500/30 selection:text-indigo-100">
      <MedusaeBackground />

      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute left-1/2 top-24 h-72 w-72 -translate-x-1/2 rounded-full bg-white/5 blur-[140px]" />
        <div className="absolute -left-24 top-0 h-[32rem] w-[32rem] rounded-full bg-indigo-500/[0.08] blur-[160px]" />
        <div className="absolute -right-24 bottom-0 h-[28rem] w-[28rem] rounded-full bg-purple-500/10 blur-[160px]" />
      </div>

      <header
        className={`fixed left-0 top-0 z-50 w-full transition-all duration-500 ${isScrolled
          ? 'border-b border-white/[0.06] bg-[#05070d]/70 py-4 backdrop-blur-xl'
          : 'bg-transparent py-6'
          }`}
      >
        <div className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:px-8 xl:px-10">
          <Link to="/" className="flex shrink-0 items-center gap-3 justify-self-start">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-[0_0_24px_rgba(99,102,241,0.35)]">
              <SynapseLogo size={24} color="#ffffff" nodeColor="#ffffff" className="h-6 w-6" />
            </div>
            <span
              className="text-2xl font-black uppercase tracking-[-0.06em] text-white"
              style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}
            >
              Synapse
            </span>
          </Link>

          <nav className="hidden items-center justify-center gap-8 lg:flex xl:gap-10">
            <NavItem href="#features">Features</NavItem>
            <NavItem href="#workflow">How It Works</NavItem>
            <NavItem href="#preview">Preview</NavItem>
            <NavItem href="#faq">FAQ</NavItem>
          </nav>

          <div className="flex items-center justify-self-end gap-2 sm:gap-3">
            {isAuthenticated && (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-white/[0.08]"
                aria-label="Open dashboard"
                title="Dashboard"
              >
                <LayoutDashboard className="h-4 w-4 text-indigo-300" />
                <span>Dashboard</span>
              </Link>
            )}

            {isAuthenticated ? (
              <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 pr-4 text-sm font-semibold text-white">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-black tracking-[0.14em] text-white shadow-[0_0_20px_rgba(99,102,241,0.35)]"
                  style={userAvatarStyle}
                >
                  {initials}
                </span>
                <span className="hidden text-left sm:flex sm:flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                    Signed In
                  </span>
                  <span className="max-w-[11rem] truncate text-sm text-white">{displayName}</span>
                </span>
              </div>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 pr-4 text-sm font-semibold text-white transition-all hover:bg-white/[0.08]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-indigo-400/30 bg-gradient-to-br from-slate-700 via-slate-800 to-[#0b1020] text-indigo-200 shadow-[0_0_18px_rgba(79,70,229,0.18)]">
                  <UserRound className="h-5 w-5" />
                </span>
                <span className="hidden text-left sm:flex sm:flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                    Account
                  </span>
                  <span className="text-sm text-white">Log in</span>
                </span>
              </Link>
            )}

            {isAuthenticated && (
              <button
                onClick={logout}
                className="hidden rounded-full px-4 py-2.5 text-sm font-semibold text-slate-400 transition-colors hover:text-white xl:inline-flex"
              >
                Log out
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="px-5 pb-24 pt-40 sm:px-6 sm:pb-28 sm:pt-48 lg:px-8">
          <div className="mx-auto flex max-w-[92rem] flex-col items-center text-center">
            <div className="mb-9 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.06] px-5 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-blue-300 shadow-[0_12px_40px_-22px_rgba(59,130,246,0.8)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
              </span>
              Now in Early Access
            </div>

            <h1
              className="mb-8 max-w-6xl text-5xl font-black leading-[1.02] tracking-tighter text-white sm:text-6xl md:text-7xl lg:text-[88px]"
              style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}
            >
              Code Together.
              <br />
              <span className="animate-gradient bg-gradient-to-r from-blue-300 via-cyan-300 to-blue-500 bg-[length:200%_auto] bg-clip-text text-transparent">
                Build Faster.
              </span>
              <br />
              Think Smarter with AI.
            </h1>

            <p className="mb-11 max-w-3xl text-base leading-8 text-gray-300 md:text-lg">
              A browser-based collaborative IDE with real-time editing, multi-language execution,
              and an AI assistant that actually understands your code.
            </p>

            <div className="flex w-full max-w-xl flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                to={isAuthenticated ? '/editor' : '/login'}
                className="group inline-flex w-full items-center justify-center gap-3 rounded-[1.35rem] bg-indigo-600 px-8 py-5 text-base font-bold text-white shadow-[0_24px_60px_rgba(79,70,229,0.35)] transition-all hover:bg-indigo-500 active:scale-[0.98] sm:w-auto sm:min-w-[18rem]"
              >
                <Terminal size={20} />
                Open the Editor
              </Link>
              <Link
                to={isAuthenticated ? '/dashboard' : '/signup'}
                className="group inline-flex w-full items-center justify-center gap-3 rounded-[1.35rem] border border-white/10 bg-white/[0.06] px-8 py-5 text-base font-bold text-white backdrop-blur-sm transition-all hover:bg-white/10 sm:w-auto sm:min-w-[18rem]"
              >
                <Zap size={20} className="text-slate-300 transition-colors group-hover:text-cyan-300" />
                {isAuthenticated ? 'Open Dashboard' : 'Start Free'}
                <ChevronRight size={18} className="transition-transform group-hover:translate-x-1" />
              </Link>
            </div>

            {!isAuthenticated ? (
              <p className="mt-8 text-xs tracking-[0.2em] text-gray-500">
                No credit card required · No local setup · All languages supported
              </p>
            ) : (
              <p className="mt-8 text-xs tracking-[0.2em] text-gray-500">
                Workspace ready · Launch your editor · Start a room with your team
              </p>
            )}
            <div className="mt-14 grid w-full max-w-5xl gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {trustStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[1.75rem] border border-white/[0.06] bg-white/[0.04] px-6 py-5 text-left backdrop-blur-xl"
                >
                  <p className="text-2xl font-black tracking-[-0.05em] text-white">{stat.value}</p>
                  <p className="mt-2 text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">
                    {stat.label}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{stat.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 pb-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[92rem] rounded-[2.25rem] border border-white/[0.06] bg-white/[0.03] px-6 py-8 backdrop-blur-xl sm:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
                  Trusted by fast-moving builders
                </p>
                <h2
                  className="mt-3 text-2xl font-black tracking-[-0.05em] text-white sm:text-3xl"
                  style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}
                >
                  One workspace for coding, collaboration, and AI reasoning.
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center text-sm font-bold uppercase tracking-[0.2em] text-slate-400 sm:grid-cols-4">
                {['BuildLab', 'SprintForge', 'CodeCircle', 'PairStack'].map((name) => (
                  <div
                    key={name}
                    className="rounded-2xl border border-white/[0.06] bg-black/20 px-5 py-4"
                  >
                    {name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="preview" className="px-5 pb-28 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[92rem]">
            <div className="absolute left-1/2 mt-12 h-20 w-72 -translate-x-1/2 rounded-full bg-indigo-500/20 blur-[120px]" />
            <div className="relative overflow-hidden rounded-[2.5rem] border border-white/[0.06] bg-[#0d1117]/80 shadow-2xl shadow-black/40 backdrop-blur-3xl">
              <div className="flex flex-col gap-4 border-b border-white/[0.06] bg-[#161b22]/50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div className="flex items-center gap-5">
                  <div className="flex gap-2.5">
                    <div className="h-3.5 w-3.5 rounded-full bg-[#ff5f57]" />
                    <div className="h-3.5 w-3.5 rounded-full bg-[#febc2e]" />
                    <div className="h-3.5 w-3.5 rounded-full bg-[#28c840]" />
                  </div>
                  <div className="hidden h-6 w-px bg-white/10 sm:block" />
                  <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
                    <Terminal size={14} className="text-indigo-400" />
                    src/main.rs
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <div className="flex -space-x-3">
                    {['A', 'B', 'C'].map((label) => (
                      <div
                        key={label}
                        className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#161b22] bg-slate-800 text-[10px] font-bold"
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-400">
                    Active
                  </div>
                </div>
              </div>

              <div className="p-6 font-mono text-sm leading-8 text-slate-300 sm:p-10 sm:text-[15px]">
                <div className="flex gap-6 sm:gap-8">
                  <div className="select-none text-right text-slate-700/70">
                    1
                    <br />
                    2
                    <br />
                    3
                    <br />
                    4
                    <br />
                    5
                    <br />
                    6
                  </div>

                  <div className="min-w-0">
                    <p>
                      <span className="text-purple-400">fn</span>{' '}
                      <span className="text-emerald-400">main</span>() {'{'}
                    </p>
                    <p>
                      &nbsp;&nbsp;<span className="text-purple-400">let</span> synapse =
                      IDE::<span className="text-indigo-400">connect</span>();
                    </p>
                    <p>&nbsp;&nbsp;</p>
                    <p>&nbsp;&nbsp;<span className="text-slate-500">{'// Collaborative sync protocol starting...'}</span></p>
                    <div className="group flex items-center gap-2">
                      <p className="min-w-0">
                        &nbsp;&nbsp;synapse.<span className="text-indigo-400">start_sync</span>().
                        <span className="text-indigo-400">await</span>;
                      </p>
                      <div className="h-6 w-[2px] bg-indigo-500 animate-pulse" />
                      <span className="rounded bg-indigo-500 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        Sarah
                      </span>
                    </div>
                    <p>{'}'}</p>
                  </div>
                </div>
              </div>

              <div
                id="status"
                className="flex flex-col gap-2 border-t border-white/[0.06] bg-indigo-500/5 px-6 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-8">
                  <span className="flex items-center gap-2 text-indigo-400">
                    <Activity size={14} /> 12ms Latency
                  </span>
                  <span>Edge Node: Lon-1</span>
                </div>
                <span>v2.4.1-Stable</span>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="px-5 pb-24 sm:px-6 lg:px-8">
          <div id="workflow" className="mx-auto mb-16 max-w-[92rem]">
            <div className="mb-12 max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-300">
                How It Works
              </p>
              <h2
                className="mt-4 text-3xl font-black tracking-[-0.05em] text-white sm:text-5xl"
                style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}
              >
                A faster path from idea to shared output.
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-400 sm:text-lg">
                Setup, collaboration, execution, and AI support in one streamlined flow.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {collaborationHighlights.map((highlight) => (
                <article
                  key={highlight.title}
                  className="relative overflow-hidden rounded-[2rem] border border-indigo-400/30 bg-white/[0.04] p-8 backdrop-blur-xl transition-all duration-300 hover:border-indigo-300/60 hover:bg-indigo-500/10"
                >
                  <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-indigo-500/10 blur-3xl" />
                  <div className="relative">
                    <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-400/20 bg-indigo-500/10 text-indigo-300">
                      <highlight.icon size={22} />
                    </div>
                    <h3 className="text-2xl font-bold text-white">{highlight.title}</h3>
                    <p className="mt-4 text-sm leading-7 text-slate-400">{highlight.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="use-cases" className="px-5 pb-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[92rem]">
            <div className="mb-12 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-300">
                  Who It&apos;s For
                </p>
                <h2
                  className="mt-4 text-3xl font-black tracking-[-0.05em] text-white sm:text-5xl"
                  style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}
                >
                  Built for real collaboration, not just solo editing in the cloud.
                </h2>
              </div>
              <p className="max-w-2xl text-base leading-8 text-slate-400">
                Built for pair programming, interviews, and classrooms.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {useCases.map((useCase) => (
                <article
                  key={useCase.title}
                  className="rounded-[2rem] border border-teal-400/30 bg-white/[0.04] p-8 backdrop-blur-xl transition-all duration-300 hover:border-teal-300/60 hover:bg-teal-500/10"
                >
                  <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-300">
                    <useCase.icon size={28} />
                  </div>
                  <h3 className="text-2xl font-bold text-white">{useCase.title}</h3>
                  <p className="mt-4 text-sm leading-7 text-slate-400">{useCase.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 pb-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[92rem]">
            <div className="mb-10 max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-300">
                What Teams Say
              </p>
              <h2
                className="mt-4 text-3xl font-black tracking-[-0.05em] text-white sm:text-5xl"
                style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}
              >
                Loved by teams building together.
              </h2>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {testimonials.map((testimonial) => (
                <article
                  key={testimonial.name}
                  className="rounded-[2rem] border border-white/[0.08] bg-[#0b1020]/70 p-8 backdrop-blur-xl transition-all duration-300 hover:border-indigo-300/40 hover:bg-indigo-500/[0.06]"
                >
                  <p className="text-base leading-8 text-slate-300">&ldquo;{testimonial.quote}&rdquo;</p>
                  <div className="mt-8 border-t border-indigo-300/15 pt-6">
                    <p className="text-sm font-bold text-white">{testimonial.name}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {testimonial.role}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="px-5 pb-24 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-[92rem] gap-8 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[2.25rem] border border-indigo-400/20 bg-[#0b1020]/75 p-8 backdrop-blur-xl transition-all duration-300 hover:border-indigo-300/40 hover:bg-indigo-500/[0.06] sm:p-10">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-300">
                FAQ
              </p>
              <h2
                className="mt-4 text-3xl font-black tracking-[-0.05em] text-white sm:text-5xl"
                style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}
              >
                Quick answers before you start.
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-400">
                Everything teams usually ask before creating a room.
              </p>
            </div>

            <div className="space-y-4">
              {faqItems.map((item) => (
                <article
                  key={item.question}
                  className="rounded-[1.75rem] border border-white/[0.08] bg-[#0b1020]/70 p-6 backdrop-blur-xl transition-all duration-300 hover:border-cyan-300/30 hover:bg-cyan-500/[0.06]"
                >
                  <h3 className="text-lg font-bold text-white">{item.question}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-400">{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 pb-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[92rem] rounded-[2.25rem] border border-indigo-400/20 bg-[#0b1020]/75 px-6 py-10 text-center backdrop-blur-xl transition-all duration-300 hover:border-indigo-300/40 hover:bg-indigo-500/[0.06] sm:px-10 sm:py-14">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/[0.08] px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-indigo-200">
              <Sparkles size={14} className="text-indigo-300" />
              Ready To Collaborate
            </div>
            <h2
              className="mb-4 text-3xl font-black tracking-[-0.05em] text-white sm:text-5xl"
              style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}
            >
              Build faster with your team in Synapse.
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Create rooms, code together in real time, run your programs, and use AI assistance
              without leaving your browser.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                to={isAuthenticated ? '/dashboard' : '/signup'}
                className="inline-flex min-w-[12rem] items-center justify-center rounded-full border border-indigo-300/20 bg-white/[0.05] px-6 py-3.5 text-sm font-bold text-white transition hover:border-indigo-300/35 hover:bg-indigo-500/[0.08]"
              >
                {isAuthenticated ? 'Open Dashboard' : 'Create Account'}
              </Link>
              <Link
                to={isAuthenticated ? '/editor' : '/login'}
                className="inline-flex min-w-[12rem] items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-3.5 text-sm font-bold text-white transition hover:from-indigo-500 hover:to-blue-500"
              >
                {isAuthenticated ? 'Open Editor' : 'Launch Editor'}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer
        id="footer"
        className="relative z-10 border-t border-white/[0.06] bg-[#05070d]/80 px-5 py-12 backdrop-blur-sm sm:px-6 lg:px-8"
      >
        <div className="mx-auto grid max-w-[92rem] gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="max-w-xl">
            <div className="flex items-center gap-3">
              <Code2 className="h-6 w-6 text-indigo-400" />
              <span
                className="text-lg font-black uppercase tracking-[-0.05em] text-white"
                style={{ fontFamily: "'Sora', 'Inter', sans-serif" }}
              >
                Synapse
              </span>
            </div>
            <p className="mt-5 text-sm leading-7 text-slate-400">
              A collaborative IDE for teams that want shared editing, code execution, and AI support
              in one browser-native workflow.
            </p>
            <p className="mt-6 font-mono text-xs text-slate-600">
              {'\u00A9'} 2026 SYNAPSE TECHNOLOGIES. BUILT FOR THE FUTURE.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {footerGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  {group.title}
                </h3>
                <div className="mt-4 space-y-3">
                  {group.links.map((link) => (
                    <a
                      key={link.label}
                      href={link.href}
                      className="block text-sm text-slate-400 transition-colors hover:text-white"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes gradient {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        .animate-gradient {
          animation: gradient 8s ease infinite;
        }

        canvas {
          display: block;
          filter: contrast(110%) brightness(110%);
        }
      `}</style>
    </div>
  );
}
