import { NextResponse } from "next/server";
import { getLiveRequestsSnapshot } from "@/lib/liveRequestsTracker.js";
import { getRequestDetails } from "@/lib/db/repos/requestDetailsRepo.js";
import { diagnoseErrors } from "@/lib/errorAnalysis/diagnose.js";

/**
 * GET /api/usage/error-analysis
 * Aggregates error records from recent requestDetails and live tracker history,
 * diagnosing recurring 429 rate limit, 410 model gone, and incompatibility patterns.
 */
export async function GET() {
  try {
    const errorLogs = [];

    // 1. Gather from live tracker history
    const liveSnapshot = getLiveRequestsSnapshot();
    if (liveSnapshot && Array.isArray(liveSnapshot.history)) {
      for (const req of liveSnapshot.history) {
        if (req.status === "error" || (req.statusCode && req.statusCode >= 400)) {
          errorLogs.push({
            id: req.id,
            timestamp: req.timestamp,
            provider: req.provider,
            model: req.model,
            statusCode: req.statusCode,
            error: req.error || `HTTP ${req.statusCode}`,
          });
        }
      }
    }

    // 2. Gather recent error details from database
    try {
      const dbErrors = await getRequestDetails({
        status: "error",
        pageSize: 100,
      });
      if (dbErrors && Array.isArray(dbErrors.details)) {
        for (const req of dbErrors.details) {
          const status = req.response?.status || req.statusCode || 500;
          const errText = req.response?.data?.error?.message || req.response?.data?.error || req.error || `HTTP ${status}`;
          errorLogs.push({
            id: req.id,
            timestamp: req.timestamp,
            provider: req.provider,
            model: req.model,
            statusCode: status,
            error: errText,
          });
        }
      }
    } catch {
      // Non-blocking if requestDetails is empty or not enabled
    }

    const diagnosis = diagnoseErrors(errorLogs);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...diagnosis,
    });
  } catch (error) {
    console.error("[API ERROR] /api/usage/error-analysis failed:", error);
    return NextResponse.json({ error: "Failed to analyze error patterns" }, { status: 500 });
  }
}
