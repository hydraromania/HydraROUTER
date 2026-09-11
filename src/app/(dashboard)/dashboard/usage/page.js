"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import LiveRequestsTab from "./components/LiveRequestsTab";
import ConsoleLogClient from "../console-log/ConsoleLogClient";
import BlockedModelsTab from "./components/BlockedModelsTab";
import ConsoleLogAnimation from "./components/ConsoleLogAnimation";
import AnalyticsTab from "./components/AnalyticsTab";
import ComboStatsTab from "./components/ComboStatsTab";
import ErrorAnalysisTab from "./components/ErrorAnalysisTab";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState("today");

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "analytics", "live", "errorAnalysis", "comboStats", "console", "animation", "blocked"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-5 px-1 sm:px-0">
      {/* Header bar: Tabs & Period Selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-border-subtle bg-surface/70 p-2 shadow-sm backdrop-blur-md">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "analytics", label: "Analytics & Comparison" },
            { value: "live", label: "Real-Time / Live" },
            { value: "errorAnalysis", label: "Error Analysis (429/410)" },
            { value: "comboStats", label: "Combo Stats" },
            { value: "console", label: "Console Log" },
            { value: "animation", label: "Console Animation" },
            { value: "blocked", label: "Blocked Models" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        {activeTab === "overview" && (
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="sm"
            className="w-full sm:w-auto self-end sm:self-auto"
          />
        )}
      </div>

      {activeTab === "overview" && <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />}
      {activeTab === "analytics" && <AnalyticsTab />}
      {activeTab === "live" && <LiveRequestsTab />}
      {activeTab === "errorAnalysis" && <ErrorAnalysisTab />}
      {activeTab === "comboStats" && <ComboStatsTab />}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "console" && <ConsoleLogClient />}
      {activeTab === "animation" && <ConsoleLogAnimation />}
      {activeTab === "blocked" && <BlockedModelsTab />}
    </div>
  );
}
