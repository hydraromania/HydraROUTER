"use client";

import Link from "next/link";
import Image from "next/image";
import { Card } from "@/shared/components";

// Derive simple connected/configured/not-installed status from API payload
function getStatus(status) {
  if (!status) return { label: "Unknown", cls: "bg-gray-500/10 text-gray-500" };
  if (!status.installed) return { label: "Not installed", cls: "bg-gray-500/10 text-gray-500" };
  if (status.hasHydraROUTER) return { label: "Connected", cls: "bg-green-500/10 text-green-600 dark:text-green-400" };
  return { label: "Not configured", cls: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" };
}

export default function ToolSummaryCard({ toolId, tool, status }) {
  const s = getStatus(status);
  return (
    <Link href={`/dashboard/cli-tools/${toolId}`} className="block group">
      <Card padding="sm" className="h-full overflow-hidden border border-border/60 hover:border-brand-500/40 hover:shadow-md transition-all duration-200 cursor-pointer">
        <div className="flex h-full flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="size-9 flex items-center justify-center shrink-0 rounded-xl bg-surface-2/60 border border-border/40 p-1 shadow-2xs">
              {tool.image ? (
                <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
              ) : tool.icon ? (
                <span className="material-symbols-outlined text-[24px]" style={{ color: tool.color }}>{tool.icon}</span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm truncate group-hover:text-brand-500 transition-colors">{tool.name}</h3>
              <span className={`inline-block mt-0.5 px-2 py-0.5 text-[10px] font-semibold rounded-full border border-border/20 ${s.cls}`}>{s.label}</span>
            </div>
            <span className="material-symbols-outlined text-text-muted text-[18px] shrink-0 group-hover:translate-x-0.5 transition-transform">chevron_right</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
