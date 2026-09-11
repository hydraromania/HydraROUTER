import { getProxyPools, getProxyPoolById, updateProxyPool } from "@/models";

// Sentinel value stored in `providerSpecificData.proxyPoolId` when a
// connection is bound to "Auto" instead of a concrete proxy pool.
export const AUTO_PROXY_POOL_ID = "__auto__";

// Pause a proxy for 3 hours after 3 consecutive 429s.
export const AUTO_PROXY_MAX_STRIKES = 3;
export const AUTO_PROXY_PAUSE_MS = 3 * 60 * 60 * 1000;

// ─── In-memory state (resets on restart; pause itself is persisted) ──
const strikeCounts = new Map(); // poolId → consecutive 429 count
const rotationIndex = new Map(); // rotationKey → last picked index

export function isAutoProxyPoolId(id) {
  return String(id || "").trim() === AUTO_PROXY_POOL_ID;
}

export function getAutoPauseRemainingMs(pool, now = Date.now()) {
  if (!pool?.autoPausedUntil) return 0;
  const until = new Date(pool.autoPausedUntil).getTime();
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, until - now);
}

export function isPoolAutoPaused(pool, now = Date.now()) {
  return getAutoPauseRemainingMs(pool, now) > 0;
}

/**
 * Filter to pools eligible for auto rotation:
 * active, has a proxy URL, and not auto-paused.
 */
export function getAvailableAutoPools(pools = [], now = Date.now()) {
  return (pools || []).filter(
    (p) => p && p.isActive === true && String(p.proxyUrl || "").trim() && !isPoolAutoPaused(p, now)
  );
}

/**
 * Round-robin pick among available pools (in-memory index per rotation key).
 */
export function pickAutoPoolId(availablePools, rotationKey = "global") {
  if (!availablePools || availablePools.length === 0) return null;
  if (availablePools.length === 1) return availablePools[0].id;
  const key = String(rotationKey || "global");
  const next = ((rotationIndex.get(key) ?? -1) + 1) % availablePools.length;
  rotationIndex.set(key, next);
  return availablePools[next].id;
}

/**
 * Resolve the concrete proxy pool for an "Auto" binding.
 * @returns {{ pool: object|null, poolId: string|null, exhausted: boolean }}
 */
export async function resolveAutoProxyPool({ rotationKey = "global" } = {}) {
  try {
    const all = await getProxyPools({ isActive: true });
    const now = Date.now();
    const available = getAvailableAutoPools(all, now);
    if (available.length === 0) {
      return { pool: null, poolId: null, exhausted: true };
    }
    const poolId = pickAutoPoolId(available, rotationKey);
    const pool = available.find((p) => p.id === poolId) || available[0];
    return { pool, poolId: pool.id, exhausted: false };
  } catch (error) {
    console.error("[autoProxyPool] Failed to resolve auto proxy:", error);
    return { pool: null, poolId: null, exhausted: true };
  }
}

/**
 * A request through this pool succeeded — clear its consecutive-429 strikes.
 * Fail-open: never throws.
 */
export async function recordAutoProxySuccess(poolId) {
  try {
    if (!poolId || isAutoProxyPoolId(poolId)) return;
    if ((strikeCounts.get(poolId) ?? 0) === 0) return;
    strikeCounts.set(poolId, 0);
    const pool = await getProxyPoolById(poolId);
    if (pool && (pool.autoConsecutive429 ?? 0) !== 0) {
      await updateProxyPool(poolId, { autoConsecutive429: 0 });
    }
  } catch (error) {
    console.warn("[autoProxyPool] record success failed:", error?.message || error);
  }
}

/**
 * A request through this pool got a 429 — increment consecutive strikes.
 * After AUTO_PROXY_MAX_STRIKES consecutive 429s the pool is auto-paused for
 * AUTO_PROXY_PAUSE_MS and the caller should rotate to the next proxy.
 * Fail-open: never throws.
 * @returns {{ paused: boolean, strikes: number, pausedUntil: string|null }}
 */
export async function recordAutoProxyRateLimit(poolId) {
  try {
    if (!poolId || isAutoProxyPoolId(poolId)) {
      return { paused: false, strikes: 0, pausedUntil: null };
    }
    const strikes = (strikeCounts.get(poolId) ?? 0) + 1;
    strikeCounts.set(poolId, strikes);

    if (strikes < AUTO_PROXY_MAX_STRIKES) {
      try {
        await updateProxyPool(poolId, { autoConsecutive429: strikes });
      } catch {}
      return { paused: false, strikes, pausedUntil: null };
    }

    // 3rd consecutive 429 → pause 3h and reset strikes
    const pausedUntil = new Date(Date.now() + AUTO_PROXY_PAUSE_MS).toISOString();
    strikeCounts.set(poolId, 0);
    try {
      await updateProxyPool(poolId, { autoPausedUntil: pausedUntil, autoConsecutive429: 0 });
    } catch (error) {
      console.warn("[autoProxyPool] Failed to persist auto-pause:", error?.message || error);
    }
    console.warn(`[autoProxyPool] Pool ${String(poolId).slice(0, 8)} got ${strikes}x consecutive 429 → auto-paused until ${pausedUntil}`);
    return { paused: true, strikes, pausedUntil };
  } catch (error) {
    console.warn("[autoProxyPool] record 429 failed:", error?.message || error);
    return { paused: false, strikes: 0, pausedUntil: null };
  }
}

/**
 * Manually resume a pool that was auto-paused (clears pause + strikes).
 */
export async function clearAutoProxyPause(poolId) {
  strikeCounts.set(poolId, 0);
  return updateProxyPool(poolId, { autoPausedUntil: null, autoConsecutive429: 0 });
}
