import { useEffect, useRef } from 'react';

class Particle {
  constructor(width, height) {
    this.x = Math.random() * width;
    this.y = Math.random() * height;
    this.vx = (Math.random() - 0.5) * 0.3;
    this.vy = (Math.random() - 0.5) * 0.3;
    this.size = Math.random() * 2 + 1;
  }

  update(width, height, mouse, mouseRadius) {
    this.x += this.vx;
    this.y += this.vy;

    if (this.x < 0 || this.x > width) this.vx *= -1;
    if (this.y < 0 || this.y > height) this.vy *= -1;

    if (mouse.x !== null) {
      const dx = mouse.x - this.x;
      const dy = mouse.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < mouseRadius) {
        const force = (mouseRadius - distance) / mouseRadius;
        this.x -= dx * force * 0.015;
        this.y -= dy * force * 0.015;
      }
    }
  }

  draw(ctx) {
    ctx.fillStyle = 'rgba(124, 58, 237, 0.4)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default function SynapseInteractiveBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let animationFrameId = 0;
    let particles = [];
    const particleCount = 100;
    const connectionDistance = 150;
    const mouseRadius = 250;
    const mouse = { x: null, y: null };
    let width = 0;
    let height = 0;

    function resizeCanvas() {
      const nextWidth = window.innerWidth;
      const nextHeight = window.innerHeight;
      const nextDevicePixelRatio = window.devicePixelRatio || 1;

      width = nextWidth;
      height = nextHeight;

      canvas.width = Math.floor(nextWidth * nextDevicePixelRatio);
      canvas.height = Math.floor(nextHeight * nextDevicePixelRatio);
      canvas.style.width = `${nextWidth}px`;
      canvas.style.height = `${nextHeight}px`;

      ctx.setTransform(nextDevicePixelRatio, 0, 0, nextDevicePixelRatio, 0, 0);
    }

    function initParticles() {
      particles = [];
      for (let index = 0; index < particleCount; index += 1) {
        particles.push(new Particle(width, height));
      }
    }

    function drawConnections() {
      for (let firstIndex = 0; firstIndex < particles.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < particles.length; secondIndex += 1) {
          const firstParticle = particles[firstIndex];
          const secondParticle = particles[secondIndex];
          const dx = firstParticle.x - secondParticle.x;
          const dy = firstParticle.y - secondParticle.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < connectionDistance) {
            let opacity = 1 - distance / connectionDistance;

            if (mouse.x !== null) {
              const midX = (firstParticle.x + secondParticle.x) / 2;
              const midY = (firstParticle.y + secondParticle.y) / 2;
              const mouseDistanceX = midX - mouse.x;
              const mouseDistanceY = midY - mouse.y;
              const mouseDistance = Math.sqrt(mouseDistanceX * mouseDistanceX + mouseDistanceY * mouseDistanceY);

              if (mouseDistance < mouseRadius) {
                opacity *= 2;
              }
            }

            ctx.strokeStyle = `rgba(100, 150, 255, ${opacity * 0.15})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(firstParticle.x, firstParticle.y);
            ctx.lineTo(secondParticle.x, secondParticle.y);
            ctx.stroke();
          }
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, width, height);

      const gradient = ctx.createRadialGradient(
        mouse.x || width / 2,
        mouse.y || height / 2,
        0,
        mouse.x || width / 2,
        mouse.y || height / 2,
        Math.max(width, height),
      );
      gradient.addColorStop(0, '#0a0f25');
      gradient.addColorStop(1, '#030712');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      drawConnections();

      particles.forEach((particle) => {
        particle.update(width, height, mouse, mouseRadius);
        particle.draw(ctx);
      });

      animationFrameId = window.requestAnimationFrame(animate);
    }

    function handleMouseMove(event) {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    }

    function handleMouseLeave() {
      mouse.x = null;
      mouse.y = null;
    }

    function handleResize() {
      resizeCanvas();
      initParticles();
    }

    resizeCanvas();
    initParticles();
    animate();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', handleResize);
      window.cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="synapse-interactive-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="synapse-interactive-bg__canvas" />
    </div>
  );
}