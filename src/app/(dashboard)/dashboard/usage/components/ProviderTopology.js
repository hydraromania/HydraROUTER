"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";

// Canvas Particle & Shockwave limits
const MAX_TRAIL_PARTICLES = 160;
const MAX_SHOCKWAVES = 6;
const RADAR_SWEEP_SPEED = 0.0018;

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || { color: "#6366f1", name: providerId };
}

export default function ProviderTopology({
  providers = [],
  activeRequests = [],
  lastProvider = "",
  errorProvider = "",
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // Tooltip & Hover interaction
  const [hoveredNode, setHoveredNode] = useState(null);
  const mousePosRef = useRef({ x: -1, y: -1 });

  // Map active / recent states
  const activeKey = useMemo(
    () => activeRequests.map((r) => r.provider?.toLowerCase()).filter(Boolean).sort().join(","),
    [activeRequests]
  );
  const lastKey = lastProvider?.toLowerCase() || "";
  const errorKey = errorProvider?.toLowerCase() || "";

  const activeSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
  const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);

  // Preload provider icons for canvas rendering
  const imagesRef = useRef({});
  useEffect(() => {
    providers.forEach((p) => {
      const src = getProviderIconSrc(p.provider);
      if (src && !imagesRef.current[p.provider]) {
        const img = new Image();
        img.src = src;
        img.onload = () => {
          imagesRef.current[p.provider] = img;
        };
      }
    });
  }, [providers]);

  // Animation Engine Refs
  const animFrameRef = useRef(null);
  const particlesRef = useRef([]);
  const shockwavesRef = useRef([]);
  const sweepAngleRef = useRef(0);
  const prevActiveCountRef = useRef(0);
  const nodePositionsRef = useRef([]);

  // Trigger shockwave on activity state change or request completion
  useEffect(() => {
    const currentActive = activeRequests.length;
    if (currentActive > 0 && prevActiveCountRef.current === 0) {
      // Core surge
      if (shockwavesRef.current.length < MAX_SHOCKWAVES) {
        shockwavesRef.current.push({
          radius: 10,
          maxRadius: 180,
          alpha: 0.9,
          color: "#6366f1",
          speed: 3.5,
        });
      }
    }
    prevActiveCountRef.current = currentActive;
  }, [activeRequests.length]);

  // Mouse move handler for hover hit-testing
  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    mousePosRef.current = { x, y };

    let found = null;
    for (const node of nodePositionsRef.current) {
      const dx = x - node.x;
      const dy = y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= node.radius + 6) {
        found = node;
        break;
      }
    }
    setHoveredNode(found);
  }, []);

  const handleMouseLeave = useCallback(() => {
    mousePosRef.current = { x: -1, y: -1 };
    setHoveredNode(null);
  }, []);

  // Main Canvas Rendering Loop (120 FPS capable)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let lastTime = performance.now();

    const render = (time) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const isDark = document.documentElement.classList.contains("dark");

      // 1. Concentric Holographic Radar Grid & Ambient Depth
      const maxOrbit = Math.min(width, height) * 0.44;
      const orbits = [0.28, 0.52, 0.76, 1.0];

      orbits.forEach((ratio, idx) => {
        const r = maxOrbit * ratio;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = isDark
          ? `rgba(99, 102, 241, ${0.04 + idx * 0.025})`
          : `rgba(99, 102, 241, ${0.06 + idx * 0.03})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // Subtle Sonar Sweep Beam
      sweepAngleRef.current = (sweepAngleRef.current + RADAR_SWEEP_SPEED) % (Math.PI * 2);
      const sweep = sweepAngleRef.current;
      const sweepGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, maxOrbit * 1.05);
      sweepGrad.addColorStop(0, "rgba(99, 102, 241, 0.15)");
      sweepGrad.addColorStop(1, "rgba(99, 102, 241, 0)");

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxOrbit * 1.05, sweep - 0.35, sweep);
      ctx.closePath();
      ctx.fillStyle = sweepGrad;
      ctx.fill();
      ctx.restore();

      // 2. Position Providers along Elliptical Neural Orbit
      const count = providers.length;
      const rx = Math.min(width * 0.42, 380);
      const ry = Math.min(height * 0.40, 210);

      const currentNodes = [];
      providers.forEach((p, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
        const nx = cx + rx * Math.cos(angle);
        const ny = cy + ry * Math.sin(angle);
        const pId = p.provider?.toLowerCase();
        const active = activeSet.has(pId);
        const last = !active && lastSet.has(pId);
        const error = !active && errorSet.has(pId);
        const config = getProviderConfig(p.provider);

        currentNodes.push({
          id: p.provider,
          name: (config.name !== p.provider ? config.name : null) || p.nodeName || p.name || p.provider,
          color: error ? "#ef4444" : active ? "#22d3ee" : last ? "#f59e0b" : config.color || "#818cf8",
          x: nx,
          y: ny,
          radius: 19,
          active,
          last,
          error,
          provider: p.provider,
        });
      });
      nodePositionsRef.current = currentNodes;

      // 3. Render Neural Synapse Beams (Router Center -> Nodes)
      currentNodes.forEach((node) => {
        ctx.save();
        ctx.beginPath();
        // Soft bezier curve towards target node
        const my = (cy + node.y) / 2;
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx, my, node.x, node.y);

        if (node.active) {
          // Active Laser Stream
          ctx.strokeStyle = "rgba(99, 102, 241, 0.25)";
          ctx.lineWidth = 4;
          ctx.stroke();

          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 1.8;
          ctx.shadowColor = "#38bdf8";
          ctx.shadowBlur = 10;
          ctx.stroke();

          // Spawn phototrail particles along this active edge
          if (particlesRef.current.length < MAX_TRAIL_PARTICLES && Math.random() < 0.4) {
            particlesRef.current.push({
              sourceX: cx,
              sourceY: cy,
              targetX: node.x,
              targetY: node.y,
              t: 0,
              speed: 0.8 + Math.random() * 0.7,
              size: 2.2 + Math.random() * 1.5,
              color: node.color,
            });
          }
        } else if (node.last) {
          ctx.strokeStyle = "rgba(245, 158, 11, 0.45)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.07)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      });

      // 4. Update & Draw Quantum Stream Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const pt = particlesRef.current[i];
        pt.t += pt.speed * dt;

        if (pt.t >= 1) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        // Quadratic interpolation to match the beam
        const my = (cy + pt.targetY) / 2;
        const inv = 1 - pt.t;
        const px = inv * inv * cx + 2 * inv * pt.t * cx + pt.t * pt.t * pt.targetX;
        const py = inv * inv * cy + 2 * inv * pt.t * my + pt.t * pt.t * pt.targetY;

        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, pt.size, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = pt.color;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.restore();
      }

      // 5. Draw Pulse Shockwaves
      for (let i = shockwavesRef.current.length - 1; i >= 0; i--) {
        const sw = shockwavesRef.current[i];
        sw.radius += sw.speed;
        sw.alpha -= 0.015;

        if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
          shockwavesRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, sw.radius, 0, Math.PI * 2);
        ctx.strokeStyle = sw.color;
        ctx.globalAlpha = Math.max(0, sw.alpha);
        ctx.lineWidth = 2;
        ctx.shadowColor = sw.color;
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.restore();
      }

      // 6. Draw Provider Nodes (Holographic Glass Discs)
      currentNodes.forEach((node) => {
        const isHovered = hoveredNode?.id === node.id;
        const radius = isHovered ? node.radius + 3 : node.radius;

        ctx.save();

        // Ambient glow ring
        if (node.active || isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 7, 0, Math.PI * 2);
          ctx.fillStyle = `${node.color}22`;
          ctx.fill();
        }

        // Base capsule disc
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? "rgba(30, 30, 36, 0.95)" : "rgba(255, 255, 255, 0.95)";
        ctx.fill();

        ctx.lineWidth = node.active ? 2.5 : isHovered ? 2 : 1;
        ctx.strokeStyle = node.active ? node.color : isHovered ? "var(--color-primary)" : isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)";
        if (node.active) {
          ctx.shadowColor = node.color;
          ctx.shadowBlur = 14;
        }
        ctx.stroke();
        ctx.restore();

        // Draw Provider Icon or initial letter
        const img = imagesRef.current[node.provider];
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius - 4, 0, Math.PI * 2);
          ctx.clip();
          const sz = (radius - 4) * 2;
          ctx.drawImage(img, node.x - sz / 2, node.y - sz / 2, sz, sz);
          ctx.restore();
        } else {
          ctx.save();
          ctx.fillStyle = node.color;
          ctx.font = "bold 11px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText((node.provider || "?").slice(0, 2).toUpperCase(), node.x, node.y);
          ctx.restore();
        }

        // Label below node
        ctx.save();
        ctx.font = isHovered ? "600 12px system-ui, sans-serif" : "500 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = isDark ? (node.active ? "#38bdf8" : "#d1d5db") : (node.active ? "#0284c7" : "#374151");
        ctx.fillText(node.name, node.x, node.y + radius + 14);
        ctx.restore();

        // Active status ring micro-pulse
        if (node.active) {
          const pulseR = radius + 3 + Math.sin(time * 0.006) * 2.5;
          ctx.save();
          ctx.beginPath();
          ctx.arc(node.x, node.y, pulseR, 0, Math.PI * 2);
          ctx.strokeStyle = node.color;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.restore();
        }
      });

      // 7. Central HydraROUTER Core Nucleus
      const isPowering = activeRequests.length > 0;
      const coreR = isPowering ? 32 + Math.sin(time * 0.005) * 2 : 28;

      ctx.save();
      // Outer aura
      ctx.beginPath();
      ctx.arc(cx, cy, coreR + 10, 0, Math.PI * 2);
      ctx.fillStyle = isPowering ? "rgba(99, 102, 241, 0.25)" : "rgba(99, 102, 241, 0.1)";
      ctx.fill();

      // Main core
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      const coreGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, coreR);
      if (isPowering) {
        coreGrad.addColorStop(0, "#818cf8");
        coreGrad.addColorStop(1, "#4f46e5");
      } else {
        coreGrad.addColorStop(0, isDark ? "#312e81" : "#e0e7ff");
        coreGrad.addColorStop(1, isDark ? "#1e1b4b" : "#c7d2fe");
      }
      ctx.fillStyle = coreGrad;
      ctx.shadowColor = isPowering ? "#6366f1" : "transparent";
      ctx.shadowBlur = isPowering ? 24 : 0;
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = isPowering ? "#c7d2fe" : "rgba(99, 102, 241, 0.4)";
      ctx.stroke();
      ctx.restore();

      // Core Icon ⚡
      ctx.save();
      ctx.font = isPowering ? "bold 18px system-ui" : "bold 16px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isPowering ? "#ffffff" : isDark ? "#a5b4fc" : "#4338ca";
      ctx.fillText("⚡", cx, cy);
      ctx.restore();

      // Central Label
      ctx.save();
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = isPowering ? (isDark ? "#c7d2fe" : "#4338ca") : (isDark ? "#9ca3af" : "#4b5563");
      ctx.fillText("HydraROUTER", cx, cy + coreR + 15);
      ctx.restore();

      // In-flight badge counter on core
      if (activeRequests.length > 0) {
        ctx.save();
        const badgeX = cx + coreR * 0.7;
        const badgeY = cy - coreR * 0.7;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, 10, 0, Math.PI * 2);
        ctx.fillStyle = "#6366f1";
        ctx.shadowColor = "#6366f1";
        ctx.shadowBlur = 8;
        ctx.fill();

        ctx.font = "bold 10px system-ui, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(activeRequests.length), badgeX, badgeY);
        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    // Pause rendering when tab hidden — save CPU/battery
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      } else if (!animFrameRef.current) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
    };
  }, [providers, activeSet, lastSet, errorSet, activeRequests.length, hoveredNode]);

  return (
    <div
      ref={containerRef}
      className="relative h-[340px] w-full min-w-0 overflow-hidden rounded-2xl border border-border-subtle bg-surface/80 shadow-sm backdrop-blur-md sm:h-[480px]"
    >
      {/* HUD Header */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-lg bg-bg/80 px-2.5 py-1 text-xs font-medium text-text-muted border border-border/50 backdrop-blur-sm">
        <span className="material-symbols-outlined text-[15px] text-indigo-500">radar</span>
        <span className="font-semibold tracking-wide">Orbital Neural Radar</span>
      </div>

      {/* Real-time Telemetry Stats Pill (Top Right) */}
      <div className="absolute top-3 right-3 z-10 hidden sm:flex items-center gap-3 rounded-lg bg-bg/80 px-3 py-1 text-[11px] text-text-muted border border-border/50 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${activeRequests.length > 0 ? "bg-cyan-400 animate-pulse" : "bg-emerald-500"}`} />
          <span>{activeRequests.length > 0 ? "Routing Synapses Active" : "Neural Grid Idle"}</span>
        </div>
        <span className="text-border">|</span>
        <span>{providers.length} Nodes</span>
      </div>

      {/* 120 FPS Interactive Radar Canvas */}
      {providers.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-muted text-sm">
          No providers connected
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="w-full h-full cursor-crosshair block"
        />
      )}

      {/* Holographic Tooltip on Hover */}
      {hoveredNode && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-xl border border-border/60 bg-surface/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md transition-all"
          style={{
            left: hoveredNode.x,
            top: hoveredNode.y - hoveredNode.radius - 10,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ backgroundColor: hoveredNode.color }} />
            <span className="font-bold text-text-main">{hoveredNode.name}</span>
          </div>
          <div className="mt-1 text-[10px] text-text-muted">
            Status:{" "}
            <span className="font-medium text-text-main">
              {hoveredNode.active ? "Streaming Active" : hoveredNode.error ? "Error / 429" : hoveredNode.last ? "Recent Route" : "Connected & Ready"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      provider: PropTypes.string,
      name: PropTypes.string,
    })
  ),
  activeRequests: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string,
      model: PropTypes.string,
      account: PropTypes.string,
    })
  ),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
};
