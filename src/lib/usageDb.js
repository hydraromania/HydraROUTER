// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData, getAnalyticsData,
  appendRequestLog, getRecentLogs,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
} from "@/lib/db/index.js";

export {
  trackRequestStart,
  trackRequestUpdate,
  trackRequestEnd,
  trackRequestError,
  getLiveRequestsSnapshot,
  clearLiveRequestsHistory,
  liveRequestsEmitter,
  registerLiveAbort,
  cancelLiveRequest,
} from "@/lib/liveRequestsTracker.js";

