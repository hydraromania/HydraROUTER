import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/models";
import { buildClearModelLocksUpdate } from "open-sse/services/accountFallback.js";
import { rateLimitTracker } from "open-sse/services/rateLimitTracker.js";
import { getRateLimitsForProvider } from "@/lib/db/index.js";

// POST /api/providers/[id]/unlock-locks — manual unlock of all model locks on one connection.
// Clears modelLock_* flat fields on the connection + tracker (cooldown + manual/permanent block).
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const clearLocks = buildClearModelLocksUpdate(connection);
    await updateProviderConnection(id, {
      ...clearLocks,
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0,
    });
    try {
      const rows = await getRateLimitsForProvider(connection.provider);
      for (const row of rows || []) {
        if (row.keyId !== id) continue;
        await rateLimitTracker.clearCooldown(id, row.modelId, connection.provider);
        await rateLimitTracker.clearManualBlock(id, row.modelId, connection.provider);
      }
    } catch {}
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error unlocking connection locks:", error);
    return NextResponse.json({ error: "Failed to unlock" }, { status: 500 });
  }
}
