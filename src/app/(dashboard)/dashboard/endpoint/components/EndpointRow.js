"use client";

import { Input } from "@/shared/components";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex items-center gap-2 p-1.5 rounded-xl border border-border-subtle/80 bg-surface/50 hover:bg-surface/80 transition-colors shadow-2xs">
      <span className={`text-xs font-mono px-2 py-1 rounded-lg shrink-0 min-w-[90px] text-center font-bold ${
          (badge === "CF" || badge === "TS") ? "bg-primary/10 text-primary border border-primary/20 glow-brand" : "bg-surface-2 text-text-muted border border-border/40"
        }`}>{label}</span>
      <Input value={url} readOnly className="flex-1 font-mono text-xs bg-bg/50 border-0 focus:ring-0" />
      <button
        onClick={() => onCopy(url, copyId)}
        className="p-2 hover:bg-brand-500/10 hover:text-brand-500 rounded-lg text-text-muted transition-all shrink-0 cursor-pointer"
        title="Copy Endpoint"
      >
        <span className="material-symbols-outlined text-[18px]">{copied === copyId ? "check" : "content_copy"}</span>
      </button>
      {actions}
    </div>
  );
}
