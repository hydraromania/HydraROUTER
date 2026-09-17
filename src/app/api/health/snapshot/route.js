import { NextResponse } from "next/server";
import { getAllRateLimits } from "@/lib/db/repos/rateLimitsRepo.js";
import { getBlockedModels } from "open-sse/services/combo.js";

export const dynamic = "force-dynamic";

// Lightweight cross-provider health snapshot: cooldowns, manual blocks,
// RPD exhaustion, combo blocks. Cheap enough for 30s dashboard polling.
export async function GET() {
  try {
    const now = Date.now();
    const rows = await getAllRateLimits();

    let cooldowns = 0;
    let manualBlocks = 0;
    const byProvider = new Map();

    for (const r of rows || []) {
      const p = byProvider.get(r.providerId) || { cooldowns: 0, manualBlocks: 0 };
      const cooling = (r.rateLimitedUntil || 0) > now;
      const manual = (r.manualBlockUntil || 0) > now;
      if (cooling) { cooldowns++; p.cooldowns++; }
      if (manual) { manualBlocks++; p.manualBlocks++; }
      byProvider.set(r.providerId, p);
    }

    const blockedComboModels = getBlockedModels();
    const nextRpdReset = rows
      .filter((r) => (r.rpdResetAt || 0) > now && (r.rpdCount || 0) > 0)
      .map((r) => r.rpdResetAt)
      .sort((a, b) => a - b)[0] || null;

    return NextResponse.json({
      ts: now,
      totals: {
        cooldowns,
        manualBlocks,
        comboBlocked: blockedComboModels.length,
      },
      providers: Object.fromEntries([...byProvider.entries()].map(([id, v]) => [id, v])),
      nextRpdReset,
    });
  } catch (error) {
    console.error("Health snapshot error:", error);
    return NextResponse.json({ error: "Failed to build snapshot" }, { status: 500 });
  }
}
