"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Card, Button, Input } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { cn } from "@/shared/utils/cn";

const LOG_LEVEL_STYLES = {
  LOG: { text: "text-emerald-300", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", bar: "bg-emerald-400", glow: "hover:bg-emerald-500/[0.07]" },
  INFO: { text: "text-sky-300", badge: "bg-sky-500/15 text-sky-300 border-sky-500/30", bar: "bg-sky-400", glow: "hover:bg-sky-500/[0.07]" },
  WARN: { text: "text-amber-300", badge: "bg-amber-500/15 text-amber-300 border-amber-500/30", bar: "bg-amber-400", glow: "hover:bg-amber-500/[0.07]" },
  ERROR: { text: "text-rose-300", badge: "bg-rose-500/15 text-rose-300 border-rose-500/40", bar: "bg-rose-500", glow: "hover:bg-rose-500/[0.08]" },
  DEBUG: { text: "text-violet-300", badge: "bg-violet-500/15 text-violet-300 border-violet-500/30", bar: "bg-violet-400", glow: "hover:bg-violet-500/[0.07]" },
  UNKNOWN: { text: "text-zinc-400", badge: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30", bar: "bg-zinc-500", glow: "hover:bg-zinc-500/[0.07]" },
};

function parseLogLine(line) {
  const timestampMatch = line.match(/^(\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\])/);
  const levelMatch = line.match(/\[(LOG|INFO|WARN|ERROR|DEBUG)\]/);
  const messageStart = timestampMatch ? timestampMatch[1].length : 0;
  const levelEnd = levelMatch ? levelMatch[0].length : 0;

  const timestamp = timestampMatch ? timestampMatch[1] : null;
  const level = levelMatch ? levelMatch[1] : "UNKNOWN";
  const message = line.substring(messageStart + levelEnd).trim();

  return { timestamp, level, message, raw: line };
}

function LogEntry({ log, isNew }) {
  const style = LOG_LEVEL_STYLES[log.level] || LOG_LEVEL_STYLES.UNKNOWN;
  return (
    <div
      className={cn(
        "group relative flex items-baseline gap-2 rounded-md px-2 py-1 transition-colors",
        style.glow,
        isNew ? "animate-fade-in bg-white/[0.04]" : ""
      )}
    >
      <span className={cn("absolute left-0 top-1 bottom-1 w-0.5 rounded-full opacity-70", style.bar)} />
      {log.timestamp && (
        <span className="shrink-0 font-mono text-[10px] text-zinc-500 group-hover:text-zinc-400 transition-colors">
          {log.timestamp}
        </span>
      )}
      <span className={cn("shrink-0 rounded border px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-wider", style.badge)}>
        {log.level}
      </span>
      <span className={cn("flex-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed", style.text)}>
        {log.message}
      </span>
    </div>
  );
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLevel, setFilterLevel] = useState("all");
  const logRef = useRef(null);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handleFilterChange = (e) => {
    setFilterLevel(e.target.value);
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "lines") {
        setLogs((prev) => {
          const next = [...prev, ...msg.lines];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Filter and search logs
  const filteredLogs = useMemo(() => {
    return logs
      .map(parseLogLine)
      .filter((log) => {
        // Filter by level
        if (filterLevel !== "all" && log.level !== filterLevel) return false;

        // Filter by search query
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matchesMessage = log.message.toLowerCase().includes(query);
          const matchesLevel = log.level.toLowerCase().includes(query);
          return matchesMessage || matchesLevel;
        }
        return true;
      })
      .slice();
  }, [logs, searchQuery, filterLevel]);

  return (
    <div className="">
      <Card className="mb-4">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center space-x-3">
            <div className="relative min-w-[200px] flex-1">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">
                search
              </span>
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="h-9 w-full rounded-lg border border-black/10 bg-surface pl-9 pr-3 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
              />
            </div>

            <select
              value={filterLevel}
              onChange={handleFilterChange}
              className="h-9 rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10 cursor-pointer"
            >
              <option value="all">All Levels</option>
              <option value="LOG">Log</option>
              <option value="INFO">Info</option>
              <option value="WARN">Warning</option>
              <option value="ERROR">Error</option>
              <option value="DEBUG">Debug</option>
            </select>
          </div>

          <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
            Clear
          </Button>
          <div className="flex items-center space-x-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                connected ? "bg-success/10 text-success" : "bg-error/10 text-error"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-success" : "bg-error")}></span>
              {connected ? "LIVE" : "DISCONNECTED"}
            </span>
          </div>
        </div>
      </Card>

      <div
        ref={logRef}
        className="rounded-xl border border-white/10 bg-[#0a0a12] p-3 text-xs font-mono h-[calc(100vh-260px)] overflow-y-auto shadow-[inset_0_0_40px_rgba(0,0,0,0.6)]"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-500">
            <span className="material-symbols-outlined text-[48px] opacity-30 mb-2">text_snippet</span>
            <p className="text-base font-semibold text-zinc-300">No logs match current filters</p>
            <p className="text-xs">Adjust search or filter levels to see logs.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredLogs.map((log, i) => (
              <LogEntry key={i} log={log} isNew={i === filteredLogs.length - 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
