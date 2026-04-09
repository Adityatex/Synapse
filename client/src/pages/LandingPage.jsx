import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import HeroSection from '../components/landing/HeroSection';
import FeatureHighlights from '../components/landing/FeatureHighlights';
import CollabPreview from '../components/landing/CollabPreview';
import HowItWorks from '../components/landing/HowItWorks';
import AIAssistantShowcase from '../components/landing/AIAssistantShowcase';
import TechStack from '../components/landing/TechStack';
import CTAAndFooter from '../components/landing/CTAAndFooter';

export default function LandingPage() {
  const backgroundRef = useRef(null);
  const { isAuthenticated, user, logout } = useAuth();

  useEffect(() => {
    document.body.style.backgroundColor = '#080b12';
    return () => {
      document.body.style.backgroundColor = '';
    };
  }, []);

  useEffect(() => {
    let effectInstance;
    let cancelled = false;

    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        const existingScript = document.querySelector(`script[src="${src}"]`);

        if (existingScript) {
          if (existingScript.dataset.loaded === 'true') {
            resolve();
            return;
          }

          existingScript.addEventListener('load', resolve, { once: true });
          existingScript.addEventListener('error', reject, { once: true });
          return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.addEventListener(
          'load',
          () => {
            script.dataset.loaded = 'true';
            resolve();
          },
          { once: true }
        );
        script.addEventListener('error', reject, { once: true });
        document.body.appendChild(script);
      });

    const initBackground = async () => {
      try {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.dots.min.js');

        if (cancelled || !backgroundRef.current || !window.VANTA?.DOTS) {
          return;
        }

        effectInstance = window.VANTA.DOTS({
          el: backgroundRef.current,
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          scale: 1,
          scaleMobile: 1,
          backgroundColor: 0x080b12,
          color: 0x2563eb,
          color2: 0x60a5fa,
          showLines: false,
          size: 3.2,
          spacing: 30,
        });
      } catch (error) {
        console.error('Failed to initialize landing background', error);
      }
    };

    initBackground();

    return () => {
      cancelled = true;
      if (effectInstance?.destroy) {
        effectInstance.destroy();
      }
    };
  }, []);

  return (
    <div
      className="relative min-h-screen w-full overflow-x-hidden bg-[#080b12] text-gray-200 selection:bg-blue-500/30"
      style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif" }}
    >
      <div ref={backgroundRef} className="absolute inset-0 z-0 opacity-55" />

      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-220px] left-[-180px] h-[720px] w-[720px] rounded-full bg-blue-700/10 blur-[150px]" />
        <div className="absolute right-[-180px] bottom-[-240px] h-[720px] w-[720px] rounded-full bg-cyan-500/10 blur-[160px]" />
        <div className="absolute top-24 left-1/2 h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-white/5 blur-[150px]" />
      </div>

      <header className="sticky top-0 left-0 z-50 w-full border-b border-white/[0.06] bg-[#080b12]/70 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full items-center justify-between px-6 md:px-10 lg:px-16">
          <div className="flex flex-shrink-0 items-center gap-3">
            <div className="h-9 w-9 flex-shrink-0 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-lg shadow-blue-900/40" />
            <span
              className="text-xl font-black text-white"
              style={{ fontFamily: "'Sora', 'Inter', sans-serif", letterSpacing: '-0.04em' }}
            >
              Synapse
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden rounded-xl px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5 hover:text-white md:inline-flex"
            >
              GitHub
            </a>
            <Link
              to={isAuthenticated ? '/editor' : '/login'}
              className="hidden rounded-xl px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5 hover:text-white md:inline-flex"
            >
              Editor
            </Link>
            <div className="mx-1 hidden h-5 w-px bg-white/10 md:block" />

            {isAuthenticated ? (
              <>
                <Link
                  to="/dashboard"
                  className="rounded-xl border border-white/[0.08] px-5 py-2.5 text-sm font-semibold text-gray-200 transition-all hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white"
                >
                  Dashboard
                </Link>
                <button
                  onClick={logout}
                  className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/30 transition-all hover:-translate-y-[1px] hover:from-blue-500 hover:to-cyan-400"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-xl border border-white/[0.08] px-5 py-2.5 text-sm font-semibold text-gray-200 transition-all hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white"
                >
                  Log in
                </Link>
                <Link
                  to="/signup"
                  className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/30 transition-all hover:-translate-y-[1px] hover:from-blue-500 hover:to-cyan-400"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 flex w-full flex-col gap-16 pb-20 sm:gap-24 md:gap-32 lg:gap-40">
        <HeroSection />
        <FeatureHighlights />
        <CollabPreview />
        <HowItWorks />
        <AIAssistantShowcase />
        <TechStack />
        <CTAAndFooter />
      </main>
    </div>
  );
}
