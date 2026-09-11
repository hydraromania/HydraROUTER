import { NextResponse } from "next/server";
import { getAnalyticsData } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    const provider = searchParams.get("provider") || "all";
    const model = searchParams.get("model") || "all";
    const connectionId = searchParams.get("connectionId") || "all";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const data = await getAnalyticsData({
      period,
      provider,
      model,
      connectionId,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get analytics data:", error);
    return NextResponse.json({ error: "Failed to fetch analytics data" }, { status: 500 });
  }
}
