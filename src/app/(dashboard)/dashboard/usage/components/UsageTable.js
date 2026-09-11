"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import PropTypes from "prop-types";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

function fmtTime(iso) {
  if (!iso) return "Never";
  const diffMins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function SortIcon({ field, currentSort, currentOrder }) {
  if (currentSort !== field) {
    return <span className="material-symbols-outlined text-[14px] opacity-30 group-hover/th:opacity-60 transition-opacity">unfold_more</span>;
  }
  return (
    <span className="material-symbols-outlined text-[14px] text-brand-500 font-bold">
      {currentOrder === "asc" ? "arrow_upward" : "arrow_downward"}
    </span>
  );
}

SortIcon.propTypes = {
  field: PropTypes.string.isRequired,
  currentSort: PropTypes.string.isRequired,
  currentOrder: PropTypes.string.isRequired,
};

/**
 * Render 4 token or cost cells based on viewMode
 */
function ValueCells({ item, viewMode, isSummary = false }) {
  if (viewMode === "tokens") {
    return (
      <>
        <td className="px-5 py-3 text-right font-mono text-xs text-text-muted">
          {isSummary && item.promptTokens === undefined ? "—" : fmt(item.promptTokens)}
        </td>
        <td className="px-5 py-3 text-right font-mono text-xs text-cyan-600 dark:text-cyan-400">
          {item.cachedTokens ? fmt(item.cachedTokens) : "—"}
        </td>
        <td className="px-5 py-3 text-right font-mono text-xs text-emerald-600 dark:text-emerald-400">
          {isSummary && item.completionTokens === undefined ? "—" : fmt(item.completionTokens)}
        </td>
        <td className="px-5 py-3 text-right font-mono text-xs font-bold text-text-main">
          {fmt(item.totalTokens)}
        </td>
      </>
    );
  }
  return (
    <>
      <td className="px-5 py-3 text-right font-mono text-xs text-text-muted">
        {isSummary && item.inputCost === undefined ? "—" : fmtCost(item.inputCost)}
      </td>
      <td className="px-5 py-3 text-right font-mono text-xs text-cyan-600 dark:text-cyan-400">
        {item.cachedCost ? fmtCost(item.cachedCost) : "—"}
      </td>
      <td className="px-5 py-3 text-right font-mono text-xs text-emerald-600 dark:text-emerald-400">
        {isSummary && item.outputCost === undefined ? "—" : fmtCost(item.outputCost)}
      </td>
      <td className="px-5 py-3 text-right font-mono text-xs font-bold text-amber-500">
        {fmtCost(item.totalCost || item.cost)}
      </td>
    </>
  );
}

ValueCells.propTypes = {
  item: PropTypes.object.isRequired,
  viewMode: PropTypes.string.isRequired,
  isSummary: PropTypes.bool,
};

/**
 * Reusable sortable usage table with expandable group rows.
 */
export default function UsageTable({
  title,
  columns,
  groupedData,
  tableType,
  sortBy,
  sortOrder,
  onToggleSort,
  viewMode,
  storageKey,
  renderDetailCells,
  renderSummaryCells,
  emptyMessage,
}) {
  const [expanded, setExpanded] = useState(new Set());
  const [search, setSearch] = useState("");

  // Load expanded state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setExpanded(new Set(JSON.parse(saved)));
    } catch (e) {
      console.error(`Failed to load ${storageKey}:`, e);
    }
  }, [storageKey]);

  // Save expanded state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch (e) {
      console.error(`Failed to save ${storageKey}:`, e);
    }
  }, [expanded, storageKey]);

  const toggleGroup = useCallback((groupKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(groupedData.map((g) => g.groupKey)));
  }, [groupedData]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const valueColumns = useMemo(() => {
    if (viewMode === "tokens") {
      return [
        { field: "promptTokens", label: "Input Tokens" },
        { field: "cachedTokens", label: "Cached" },
        { field: "completionTokens", label: "Output Tokens" },
        { field: "totalTokens", label: "Total Tokens" },
      ];
    }
    return [
      { field: "promptTokens", label: "Input Cost" },
      { field: "cachedCost", label: "Cached Cost" },
      { field: "completionTokens", label: "Output Cost" },
      { field: "cost", label: "Total Cost" },
    ];
  }, [viewMode]);

  // Filter groupedData by search query
  const filteredData = useMemo(() => {
    if (!search.trim()) return groupedData;
    const q = search.toLowerCase();
    return groupedData
      .map((g) => {
        const matchesGroup = g.groupKey?.toLowerCase().includes(q);
        const matchingItems = g.items.filter((item) =>
          Object.values(item).some((v) => typeof v === "string" && v.toLowerCase().includes(q))
        );
        if (matchesGroup || matchingItems.length > 0) {
          return {
            ...g,
            items: matchesGroup ? g.items : matchingItems,
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [groupedData, search]);

  const totalColSpan = columns.length + valueColumns.length;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl glass-panel shadow-sm transition-all">
      {/* Table Toolbar */}
      <div className="flex flex-col gap-3 border-b border-border/60 bg-bg-subtle/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {title && <h3 className="font-bold text-sm text-text-main">{title}</h3>}
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="rounded-full bg-bg border border-border/60 px-2 py-0.5 font-medium">
              {filteredData.length} {filteredData.length === 1 ? "group" : "groups"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Search */}
          <div className="relative flex-1 sm:w-64">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">
              search
            </span>
            <input
              type="text"
              placeholder="Search usage..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-bg/60 py-1.5 pl-8 pr-3 text-xs text-text-main placeholder-text-muted transition-all focus:border-brand-500 focus:bg-bg focus:outline-none focus:ring-1 focus:ring-brand-500/50"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>

          {/* Expand/Collapse All */}
          <div className="flex items-center rounded-xl border border-border/60 bg-bg p-0.5">
            <button
              onClick={expandAll}
              title="Expand All"
              className="flex size-7 items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-main transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">unfold_more</span>
            </button>
            <button
              onClick={collapseAll}
              title="Collapse All"
              className="flex size-7 items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-main transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">unfold_less</span>
            </button>
          </div>
        </div>
      </div>

      {/* Table Data */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border/60 bg-bg-subtle/50 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.field}
                  className={`group/th cursor-pointer select-none px-5 py-3.5 transition-colors hover:bg-bg-subtle ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  <div className={`inline-flex items-center gap-1.5 ${col.align === "right" ? "justify-end" : ""}`}>
                    <span>{col.label}</span>
                    <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                  </div>
                </th>
              ))}
              {valueColumns.map((col) => (
                <th
                  key={col.field}
                  className="group/th cursor-pointer select-none px-5 py-3.5 text-right transition-colors hover:bg-bg-subtle"
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  <div className="inline-flex items-center justify-end gap-1.5">
                    <span>{col.label}</span>
                    <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {filteredData.map((group) => {
              const isExpanded = expanded.has(group.groupKey);
              return (
                <Fragment key={group.groupKey}>
                  {/* Group summary row */}
                  <tr
                    className="group/row cursor-pointer transition-colors hover:bg-bg-subtle/70 bg-surface/40"
                    onClick={() => toggleGroup(group.groupKey)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex size-5 items-center justify-center rounded-md bg-bg border border-border/50 text-text-muted transition-transform duration-200 ${
                            isExpanded ? "rotate-90 bg-brand-500/10 text-brand-500 border-brand-500/30" : ""
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                        </span>
                        <span className={`font-semibold text-sm transition-colors ${group.summary.pending > 0 ? "text-brand-500" : "text-text-main"}`}>
                          {group.groupKey}
                        </span>
                        <span className="rounded-full bg-bg/80 border border-border/40 px-1.5 py-0.2 text-[10px] text-text-muted">
                          {group.items.length}
                        </span>
                      </div>
                    </td>
                    {renderSummaryCells(group)}
                    <ValueCells item={group.summary} viewMode={viewMode} isSummary />
                  </tr>
                  {/* Detail rows */}
                  {isExpanded &&
                    group.items.map((item) => (
                      <tr
                        key={`detail-${item.key}`}
                        className="transition-colors hover:bg-bg-subtle/40 bg-bg/30"
                      >
                        {renderDetailCells(item)}
                        <ValueCells item={item} viewMode={viewMode} />
                      </tr>
                    ))}
                </Fragment>
              );
            })}
            {filteredData.length === 0 && (
              <tr>
                <td colSpan={totalColSpan} className="px-6 py-12 text-center text-text-muted">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[32px] opacity-40">filter_list_off</span>
                    <span>{search ? "No matching usage records found." : emptyMessage}</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

UsageTable.propTypes = {
  title: PropTypes.string.isRequired,
  columns: PropTypes.arrayOf(
    PropTypes.shape({
      field: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      align: PropTypes.string,
    })
  ).isRequired,
  groupedData: PropTypes.array.isRequired,
  tableType: PropTypes.string.isRequired,
  sortBy: PropTypes.string.isRequired,
  sortOrder: PropTypes.string.isRequired,
  onToggleSort: PropTypes.func.isRequired,
  viewMode: PropTypes.string.isRequired,
  storageKey: PropTypes.string.isRequired,
  renderDetailCells: PropTypes.func.isRequired,
  renderSummaryCells: PropTypes.func.isRequired,
  emptyMessage: PropTypes.string.isRequired,
};

// Re-export utilities for use in UsageStats orchestrator
export { fmt, fmtCost, fmtTime };
