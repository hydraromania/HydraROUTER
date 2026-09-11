import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";
import { getProviderConnections } from "@/models";

export const dynamic = "force-dynamic";

// PUT /api/providers/reorder - Reorder connections in batch
export async function PUT(request) {
  try {
    const body = await request.json();
    const { orderedIds, provider } = body || {};

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json({ error: "orderedIds array is required" }, { status: 400 });
    }

    const db = await getAdapter();
    db.transaction(() => {
      orderedIds.forEach((id, index) => {
        db.run(`UPDATE providerConnections SET priority = ?, updatedAt = ? WHERE id = ?`, [
          index + 1,
          new Date().toISOString(),
          id,
        ]);
      });
    });

    const connections = await getProviderConnections(provider ? { provider } : {});
    return NextResponse.json({ success: true, connections });
  } catch (error) {
    console.error("Error reordering connections:", error);
    return NextResponse.json({ error: "Failed to reorder connections" }, { status: 500 });
  }
}
