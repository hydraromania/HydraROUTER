"use client";

import { useState, useEffect, useRef } from "react";
import { getStatusVariant as getConnectionStatusVariant } from "@/shared/utils/connectionStatus";
import PropTypes from "prop-types";
import { Badge, Toggle, Tooltip } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import CooldownTimer from "./CooldownTimer";

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export default function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete, oneByOneStatus = null, autoPing = null, dragHandleProps = null }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const { copied, copy } = useCopyToClipboard();
  const proxyDropdownRef = useRef(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const isAutoProxy = boundProxyPoolId === "__auto__";
  // Auto proxy rotation is only available for the opencode provider.
  const showAutoProxy = connection.provider === "opencode";
  const boundProxyPool = !boundProxyPoolId || isAutoProxy ? null : proxyPoolMap.get(boundProxyPoolId);
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;
  const proxyDisplayText = isAutoProxy
    ? "Pool: Auto (rotate)"
    : boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";
  const autoPingTooltip = autoPing?.provider === "codex"
    ? "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota."
    : "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.";

  let maskedProxyUrl = "";
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
    const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
    try {
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (isAutoProxy) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "error";
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target)) {
        setShowProxyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  const rowAuthType = connection.authType || (isOAuth ? "oauth" : "apikey");
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const authIcon = isCookieConnection ? "cookie" : isOAuthConnection ? "lock" : "key";
  const authLabel = isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key";
  const displayName = connection.name?.trim()
    || connection.email?.trim()
    || connection.displayName?.trim()
    || (isOAuthConnection ? "OAuth Account" : isCookieConnection ? "Cookie Account" : "API Key");
  const secondaryDisplayName = connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()
    ? connection.email.trim()
    : connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()
      ? connection.displayName.trim()
      : null;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter(v => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter(v => v && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired u2192 treat as active
    : connection.testStatus;

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus);

  const getOneByOneVariant = () => {
    if (!oneByOneStatus) return "default";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return "error";
    if (oneByOneStatus.state === "testing") return "primary";
    return "default";
  };

  const getOneByOneLabel = () => {
    if (!oneByOneStatus) return null;
    if (oneByOneStatus.state === "queued") return "queued";
    if (oneByOneStatus.state === "testing") return "testing";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return oneByOneStatus.error ? `failed: ${oneByOneStatus.error}` : "failed";
    return null;
  };

  return (
    <div className={`group flex min-w-0 flex-col gap-2.5 rounded-xl border border-border/40 bg-surface/60 p-2.5 shadow-sm transition-all hover:border-primary/30 hover:bg-surface sm:flex-row sm:items-center sm:justify-between ${connection.isActive === false ? "opacity-60 grayscale-[30%]" : ""}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-2.5">
        {/* Drag handle & Up/Down arrows */}
        <div className="flex shrink-0 items-center gap-1">
          {dragHandleProps && (
            <button
              {...dragHandleProps}
              type="button"
              className="flex h-7 w-5 cursor-grab touch-none items-center justify-center rounded text-text-muted/50 transition-colors hover:bg-black/5 hover:text-primary active:cursor-grabbing dark:hover:bg-white/5"
              title="Drag to reorder priority"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="4" r="2"/><circle cx="15" cy="4" r="2"/>
                <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
                <circle cx="9" cy="20" r="2"/><circle cx="15" cy="20" r="2"/>
              </svg>
            </button>
          )}
          <div className="flex flex-col">
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              title="Move up"
              className={`flex h-4 w-4 items-center justify-center rounded transition-colors ${isFirst ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:bg-primary/10 hover:text-primary"}`}
            >
              <span className="material-symbols-outlined text-[15px] leading-none">keyboard_arrow_up</span>
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              title="Move down"
              className={`flex h-4 w-4 items-center justify-center rounded transition-colors ${isLast ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:bg-primary/10 hover:text-primary"}`}
            >
              <span className="material-symbols-outlined text-[15px] leading-none">keyboard_arrow_down</span>
            </button>
          </div>
        </div>

        {/* Priority Badge */}
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-bg border border-border/50 text-[11px] font-bold text-text-main font-mono">
          {connection.priority || 1}
        </div>

        {/* Auth Icon */}
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[16px]">
            {authIcon}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{displayName}</p>
            {connection.apiKey && (
              <div className="inline-flex items-center gap-1 rounded bg-black/5 px-2 py-0.5 font-mono text-xs dark:bg-white/5">
                <span className="text-text-muted">{showKey ? connection.apiKey : maskKey(connection.apiKey)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowKey(!showKey);
                  }}
                  className="p-0.5 rounded text-text-muted hover:text-primary transition-colors flex items-center justify-center"
                  title={showKey ? "Ascunde cheia" : "Arată cheia"}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {showKey ? "visibility_off" : "visibility"}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copy(connection.apiKey, connection.id);
                  }}
                  className="p-0.5 rounded text-text-muted hover:text-primary transition-colors flex items-center justify-center"
                  title="Copiază cheia"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {copied === connection.id ? "check" : "content_copy"}
                  </span>
                </button>
              </div>
            )}
          </div>
          {secondaryDisplayName && (
            <p className="text-xs text-text-muted truncate">{secondaryDisplayName}</p>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            <Badge variant="default" size="sm">
              {authLabel}
            </Badge>
            {hasAnyProxy && (
              <Badge variant={proxyBadgeVariant} size="sm">
                {isAutoProxy ? "Auto" : "Proxy"}
              </Badge>
            )}
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
            {/* ponytail: deblocarea modelelor e doar jos în tabelul RPD/TPM/RPM, nu la listarea cheii. */}
            {connection.lastError && connection.isActive !== false && (
              <span className="max-w-full truncate text-xs text-red-500 sm:max-w-[300px]" title={connection.lastError}>
                {connection.lastError}
              </span>
            )}
            {connection.globalPriority && (
              <span className="text-[11px] text-text-muted">Auto: {connection.globalPriority}</span>
            )}
            {getOneByOneLabel() && (
              <Badge variant={getOneByOneVariant()} size="sm">
                {getOneByOneLabel()}
              </Badge>
            )}
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[420px]" title={proxyDisplayText}>
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[260px]">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[320px]" title={noProxyText}>
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="grid flex-1 grid-cols-3 gap-1 sm:flex sm:flex-none">
          {/* Proxy button with inline dropdown */}
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <button
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`flex w-full flex-col items-center rounded px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${hasAnyProxy ? "text-primary" : "text-text-muted hover:text-primary"}`}
                disabled={updatingProxy}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {updatingProxy ? "progress_activity" : "lan"}
                </span>
                <span className="text-[10px] leading-tight">Proxy</span>
              </button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 max-w-[78vw] min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                  <button
                    onClick={() => handleSelectProxy("__none__")}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${!boundProxyPoolId ? "text-primary font-medium" : "text-text-main"}`}
                  >
                    None
                  </button>
                  {showAutoProxy && (
                  <button
                    onClick={() => handleSelectProxy("__auto__")}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${isAutoProxy ? "text-primary font-medium" : "text-text-main"}`}
                    title="Rotate automatically through all active proxies. A proxy is paused 3h after 3 consecutive 429s."
                  >
                    Auto (rotate)
                  </button>
                  )}
                  {(proxyPools || []).map((pool) => (
                    <button
                      key={pool.id}
                      onClick={() => handleSelectProxy(pool.id)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${boundProxyPoolId === pool.id ? "text-primary font-medium" : "text-text-main"}`}
                    >
                      {pool.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {autoPing && (
            <Tooltip text={autoPingTooltip}>
              <button
                onClick={() => autoPing.onToggle(!autoPing.on)}
                className={`flex w-full flex-col items-center rounded px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${autoPing.on ? "text-primary" : "text-text-muted hover:text-primary"}`}
              >
                <span className="material-symbols-outlined text-[18px]">bolt</span>
                <span className="text-[10px] leading-tight">Auto-ping</span>
              </button>
            </Tooltip>
          )}
          <button onClick={onEdit} className="flex flex-col items-center rounded px-2 py-1 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5">
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span className="text-[10px] leading-tight">Edit</span>
          </button>
          <button onClick={onDelete} className="flex flex-col items-center rounded px-2 py-1 text-red-500 hover:bg-red-500/10">
            <span className="material-symbols-outlined text-[18px]">delete</span>
            <span className="text-[10px] leading-tight">Delete</span>
          </button>
        </div>
        <Toggle
          size="sm"
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          title={(connection.isActive ?? true) ? "Disable connection" : "Enable connection"}
        />
      </div>
    </div>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    modelLockUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
  }).isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    proxyUrl: PropTypes.string,
    noProxy: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  oneByOneStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  autoPing: PropTypes.shape({
    on: PropTypes.bool,
    onToggle: PropTypes.func,
    provider: PropTypes.string,
  }),
  dragHandleProps: PropTypes.object,
};
