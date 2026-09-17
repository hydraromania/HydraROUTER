"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Static nav entries mirror Sidebar.js — keep in sync when nav changes.
const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: "home", keywords: "overview" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart", keywords: "analytics requests" },
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api", keywords: "api key" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns", keywords: "connections" },
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: "layers", keywords: "combo fallback" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage", keywords: "quota limits" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings", keywords: "rtk" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal", keywords: "codex cline copilot" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate", keywords: "debug" },
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan", keywords: "proxy" },
  { href: "/dashboard/media-providers/embedding", label: "Embedding Providers", icon: "functions", keywords: "media" },
  { href: "/dashboard/media-providers/image", label: "Image Providers", icon: "image", keywords: "media" },
  { href: "/dashboard/media-providers/video", label: "Video Providers", icon: "movie", keywords: "media" },
  { href: "/dashboard/media-providers/tts", label: "TTS Providers", icon: "record_voice_over", keywords: "media audio" },
  { href: "/dashboard/media-providers/stt", label: "STT Providers", icon: "graphic_eq", keywords: "media audio" },
  { href: "/dashboard/media-providers/web", label: "Web Fetch & Search", icon: "travel_explore", keywords: "web" },
  { href: "/dashboard/profile", label: "Settings", icon: "settings", keywords: "profile" },
  { href: "/dashboard/console-log", label: "Console Log", icon: "console", keywords: "logs" },
];

// Simple subsequence fuzzy score: earlier + denser matches rank higher.
function fuzzyScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      streak++;
      score += 1 + streak + (i === 0 ? 5 : 0);
      qi++;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : -1;
}

const notif = () =>
  import("@/store/notificationStore").then((m) => m.useNotificationStore.getState());

// Actions the palette can run directly. id is unique per action.
const ACTIONS = [
  {
    id: "act:restart-headroom",
    label: "Restart Headroom Proxy",
    icon: "restart_alt",
    keywords: "headroom proxy restart",
    run: async () => {
      const res = await fetch("/api/headroom/restart", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) notif().success("Headroom proxy restarted");
      else notif().error(json?.error || "Restart failed");
    },
  },
  {
    id: "act:clear-live",
    label: "Clear Live Requests History",
    icon: "delete_sweep",
    keywords: "usage live clear history",
    run: async () => {
      const res = await fetch("/api/usage/live", { method: "DELETE" });
      if (res.ok) notif().success("Live requests history cleared");
      else notif().error("Clear failed");
    },
  },
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [dynamic, setDynamic] = useState({ providers: [], combos: [] });
  const inputRef = useRef(null);

  // Fetch providers + combos once per open (fresh enough, cheap).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([
      fetch("/api/providers", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/combos", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([p, c]) => {
      if (!alive) return;
      setDynamic({
        providers: (p?.connections || []).map((conn) => ({
          id: `prov:${conn.id}`,
          label: `${conn.provider}${conn.name ? ` — ${conn.name}` : ""}`,
          icon: "dns",
          keywords: `provider connection ${conn.provider} ${conn.name || ""}`,
          href: `/dashboard/providers/${conn.id}`,
        })),
        combos: (c?.combos || []).map((combo) => ({
          id: `combo:${combo.name}`,
          label: `Combo: ${combo.name}`,
          icon: "layers",
          keywords: `combo ${combo.name}`,
          href: `/dashboard/combos`,
        })),
      });
    });
    return () => {
      alive = false;
    };
  }, [open]);

  const items = useMemo(
    () => [...NAV_ITEMS, ...ACTIONS, ...dynamic.providers, ...dynamic.combos],
    [dynamic]
  );

  const results = useMemo(() => {
    if (!query) return items.slice(0, 10);
    return items
      .map((item) => ({
        item,
        score: Math.max(
          fuzzyScore(query, item.label),
          fuzzyScore(query, item.keywords || "") / 2
        ),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((r) => r.item);
  }, [items, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }, []);

  const runItem = useCallback(
    async (item) => {
      close();
      if (item.run) {
        try {
          await item.run();
        } catch (e) {
          notif().error(e?.message || "Action failed");
        }
      } else {
        router.push(item.href);
      }
    },
    [close, router]
  );

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen((o) => (o ? (close(), o) : o));
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hydrarouter:open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hydrarouter:open-command-palette", onOpen);
    };
  }, [close]);

  useEffect(() => {
    if (open) {
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 pt-[15vh] backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="animate-pop-in w-[min(92vw,560px)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border-subtle px-4">
          <span className="material-symbols-outlined text-[20px] text-text-subtle">search</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && results[selected]) { e.preventDefault(); runItem(results[selected]); }
            }}
            placeholder="Search pages, providers, combos, actions…"
            className="w-full bg-transparent py-3.5 text-sm text-text-main outline-none placeholder:text-text-subtle"
            aria-label="Search commands"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-subtle">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto custom-scrollbar p-2" role="listbox">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-text-muted">No results</li>
          )}
          {results.map((item, i) => (
            <li key={item.id || item.href} role="option" aria-selected={i === selected}>
              <button
                type="button"
                onMouseEnter={() => setSelected(i)}
                onClick={() => runItem(item)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                  i === selected ? "bg-brand-500/10 text-brand-600 dark:text-brand-400" : "text-text-main hover:bg-surface-2"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.run && (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-text-muted">action</span>
                )}
                {i === selected && <kbd className="rounded border border-border px-1 text-[10px] text-text-subtle">↵</kbd>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
