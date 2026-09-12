import { getModelRateLimits, getRpdResetTime } from "../config/modelRateLimits.js";
import {
  getRateLimit,
  getRateLimitsForProvider,
  upsertRateLimit,
  updateRpdCount,
  updateRpmCount,
  updateTpmCount,
  updateRateLimitedUntil,
  updateManualBlockUntil,
  deleteRateLimit,
  cleanupExpiredRateLimits
} from "@/lib/db/index.js";

/**
 * Rate limit tracker per API key per model with persistent RPD storage
 * RPD (Requests Per Day) persists across server restarts and only resets based on time
 */
class RateLimitTracker {
  constructor() {
    this.trackers = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
    this._dbInitialized = false;
  }

  async _ensureDbInitialized() {
    if (this._dbInitialized) return;
    try {
      await cleanupExpiredRateLimits(Date.now());
      this._dbInitialized = true;
    } catch (e) {
      console.warn("[RATE_LIMIT_TRACKER] DB init failed, continuing with in-memory only:", e.message);
      this._dbInitialized = true;
    }
  }

  getKeyTracker(keyId) {
    if (!this.trackers.has(keyId)) {
      this.trackers.set(keyId, new Map());
    }
    return this.trackers.get(keyId);
  }

  async getModelTracker(keyId, modelId, providerId) {
    await this._ensureDbInitialized();
    
    const keyTracker = this.getKeyTracker(keyId);
    if (!keyTracker.has(modelId)) {
      const limits = getModelRateLimits(providerId, modelId);
      const now = Date.now();
      const rpdReset = getRpdResetTime(limits.rpdResetHour, limits.resetTz);
      let rpdResetAt = rpdReset.getTime();

      let rpdCount = 0;
      let rpmCount = 0;
      let rpmResetAt = now + 60 * 1000;
      let tpmCount = 0;
      let tpmResetAt = now + 60 * 1000;
      let rateLimitedUntil = 0;
      let manualBlockUntil = 0;

      try {
        const persisted = await getRateLimit(keyId, modelId, providerId);
        if (persisted) {
          if (persisted.rpdResetAt > now) {
            rpdCount = persisted.rpdCount || 0;
            rpdResetAt = persisted.rpdResetAt;
          }
          if (persisted.rpmResetAt > now) {
            rpmCount = persisted.rpmCount || 0;
            rpmResetAt = persisted.rpmResetAt;
          }
          if (persisted.tpmResetAt > now) {
            tpmCount = persisted.tpmCount || 0;
            tpmResetAt = persisted.tpmResetAt;
          }
          if (persisted.rateLimitedUntil > now) {
            rateLimitedUntil = persisted.rateLimitedUntil;
          }
          if (persisted.manualBlockUntil > now) {
            manualBlockUntil = persisted.manualBlockUntil;
          }
        }
      } catch (e) {
        console.warn("[RATE_LIMIT_TRACKER] Failed to load persisted limits:", e.message);
      }

      keyTracker.set(modelId, {
        providerId,
        rpm: { count: rpmCount, resetAt: rpmResetAt },
        tpm: { count: tpmCount, resetAt: tpmResetAt },
        rpd: { count: rpdCount, resetAt: rpdResetAt },
        limits,
        rateLimitedUntil,
        manualBlockUntil,
      });
    }
    const tracker = keyTracker.get(modelId);
    tracker.limits = getModelRateLimits(tracker.providerId || providerId, modelId);
    return tracker;
  }

  async checkLimit(keyId, modelId, providerId, estimatedTokens = 0) {
    if (!keyId || keyId === "noauth") return { allowed: true, limits: {} };
    const tracker = await this.getModelTracker(keyId, modelId, providerId);
    const now = Date.now();

    if (now >= tracker.rpm.resetAt) {
      tracker.rpm.count = 0;
      tracker.rpm.resetAt = now + 60 * 1000;
      await updateRpmCount(keyId, modelId, providerId, 0, tracker.rpm.resetAt);
    }
    if (now >= tracker.tpm.resetAt) {
      tracker.tpm.count = 0;
      tracker.tpm.resetAt = now + 60 * 1000;
      await updateTpmCount(keyId, modelId, providerId, 0, tracker.tpm.resetAt);
    }
    if (now >= tracker.rpd.resetAt) {
      tracker.rpd.count = 0;
      const rpdReset = getRpdResetTime(tracker.limits.rpdResetHour, tracker.limits.resetTz);
      tracker.rpd.resetAt = rpdReset.getTime();
      await updateRpdCount(keyId, modelId, providerId, 0, tracker.rpd.resetAt);
    }

    if (tracker.manualBlockUntil > now) {
      const retryAfterMs = tracker.manualBlockUntil - now;
      return { allowed: false, retryAfterMs, limits: tracker.limits, reason: "manually blocked" };
    }

    if (tracker.rateLimitedUntil > now) {
      const retryAfterMs = tracker.rateLimitedUntil - now;
      return { allowed: false, retryAfterMs, limits: tracker.limits, reason: "429 cooldown" };
    }

    const limits = tracker.limits;
    
    if (tracker.rpm.count >= limits.rpm) {
      const retryAfterMs = tracker.rpm.resetAt - now;
      return { allowed: false, retryAfterMs, limits, reason: "RPM exceeded" };
    }
    
    if (tracker.tpm.count + estimatedTokens > limits.tpm) {
      const retryAfterMs = tracker.tpm.resetAt - now;
      return { allowed: false, retryAfterMs, limits, reason: "TPM exceeded" };
    }
    
    if (tracker.rpd.count >= limits.rpd) {
      const retryAfterMs = tracker.rpd.resetAt - now;
      return { allowed: false, retryAfterMs, limits, reason: "RPD exceeded" };
    }

    return { allowed: true, limits };
  }

  async recordRequest(keyId, modelId, providerId, tokensUsed = 0) {
    if (!keyId || keyId === "noauth") return { rpm: { used: 0 }, tpm: { used: 0 }, rpd: { used: 0 } };
    const tracker = await this.getModelTracker(keyId, modelId, providerId);
    const now = Date.now();

    if (now >= tracker.rpm.resetAt) {
      tracker.rpm.count = 0;
      tracker.rpm.resetAt = now + 60 * 1000;
      await updateRpmCount(keyId, modelId, providerId, 0, tracker.rpm.resetAt);
    }
    if (now >= tracker.tpm.resetAt) {
      tracker.tpm.count = 0;
      tracker.tpm.resetAt = now + 60 * 1000;
      await updateTpmCount(keyId, modelId, providerId, 0, tracker.tpm.resetAt);
    }
    if (now >= tracker.rpd.resetAt) {
      tracker.rpd.count = 0;
      const rpdReset = getRpdResetTime(tracker.limits.rpdResetHour, tracker.limits.resetTz);
      tracker.rpd.resetAt = rpdReset.getTime();
      await updateRpdCount(keyId, modelId, providerId, 0, tracker.rpd.resetAt);
    }

    tracker.rpm.count += 1;
    tracker.tpm.count += tokensUsed || 0;

    await updateRpmCount(keyId, modelId, providerId, tracker.rpm.count, tracker.rpm.resetAt);
    await updateTpmCount(keyId, modelId, providerId, tracker.tpm.count, tracker.tpm.resetAt);

    return {
      rpm: { used: tracker.rpm.count, limit: tracker.limits.rpm, resetAt: tracker.rpm.resetAt },
      tpm: { used: tracker.tpm.count, limit: tracker.limits.tpm, resetAt: tracker.tpm.resetAt },
      rpd: { used: tracker.rpd.count, limit: tracker.limits.rpd, resetAt: tracker.rpd.resetAt },
    };
  }

  getTrackedModelsForProvider(keyIds) {
    const seen = new Set();
    for (const keyId of keyIds) {
      const keyTracker = this.trackers.get(keyId);
      if (!keyTracker) continue;
      for (const modelId of keyTracker.keys()) seen.add(modelId);
    }
    return [...seen];
  }

  async getUsage(keyId, modelId, providerId) {
    await this._ensureDbInitialized();
    const keyTracker = this.trackers.get(keyId);
    if (!keyTracker) return null;
    const tracker = keyTracker.get(modelId);
    if (!tracker) return null;

    const now = Date.now();
    return {
      rpm: { used: tracker.rpm.count, limit: tracker.limits.rpm, resetAt: tracker.rpm.resetAt, remaining: Math.max(0, tracker.limits.rpm - tracker.rpm.count) },
      tpm: { used: tracker.tpm.count, limit: tracker.limits.tpm, resetAt: tracker.tpm.resetAt, remaining: Math.max(0, tracker.limits.tpm - tracker.tpm.count) },
      rpd: { used: tracker.rpd.count, limit: tracker.limits.rpd, resetAt: tracker.rpd.resetAt, remaining: Math.max(0, tracker.limits.rpd - tracker.rpd.count) },
    };
  }

  async getAllKeysUsage(modelId, providerId) {
    await this._ensureDbInitialized();
    const now = Date.now();
    const limits = getModelRateLimits(providerId, modelId);
    // DB rows first: survive restarts and other processes (dashboard API may
    // run in a chunk whose in-memory map was never warmed by traffic).
    const merged = new Map();
    try {
      const persisted = await getRateLimitsForProvider(providerId);
      for (const row of persisted || []) {
        if (row.modelId !== modelId) continue;
        const rpmUsed = row.rpmResetAt > now ? (row.rpmCount || 0) : 0;
        const tpmUsed = row.tpmResetAt > now ? (row.tpmCount || 0) : 0;
        const rpdUsed = row.rpdResetAt > now ? (row.rpdCount || 0) : 0;
        merged.set(row.keyId, {
          keyId: row.keyId,
          rpm: { used: rpmUsed, limit: limits.rpm, remaining: Math.max(0, limits.rpm - rpmUsed) },
          tpm: { used: tpmUsed, limit: limits.tpm, remaining: Math.max(0, limits.tpm - tpmUsed) },
          rpd: { used: rpdUsed, limit: limits.rpd, remaining: Math.max(0, limits.rpd - rpdUsed) },
          rateLimitedUntil: row.rateLimitedUntil > now ? row.rateLimitedUntil : 0,
          manualBlockUntil: row.manualBlockUntil > now ? row.manualBlockUntil : 0,
        });
      }
    } catch (e) {
      console.warn("[RATE_LIMIT_TRACKER] Failed to load persisted usage:", e.message);
    }
    // In-memory overlay: freshest counters in this process win.
    for (const [keyId, keyTracker] of this.trackers.entries()) {
      const tracker = keyTracker.get(modelId);
      if (tracker) {
        merged.set(keyId, {
          keyId,
          rpm: { used: tracker.rpm.count, limit: tracker.limits.rpm, remaining: Math.max(0, tracker.limits.rpm - tracker.rpm.count) },
          tpm: { used: tracker.tpm.count, limit: tracker.limits.tpm, remaining: Math.max(0, tracker.limits.tpm - tracker.tpm.count) },
          rpd: { used: tracker.rpd.count, limit: tracker.limits.rpd, remaining: Math.max(0, tracker.limits.rpd - tracker.rpd.count) },
          rateLimitedUntil: tracker.rateLimitedUntil,
          manualBlockUntil: tracker.manualBlockUntil || 0,
        });
      }
    }
    return [...merged.values()];
  }

  async recordSuccess(keyId, modelId, providerId) {
    if (!keyId || keyId === "noauth") return null;
    const tracker = await this.getModelTracker(keyId, modelId, providerId);
    const now = Date.now();

    if (now >= tracker.rpm.resetAt) {
      tracker.rpm.count = 0;
      tracker.rpm.resetAt = now + 60 * 1000;
      await updateRpmCount(keyId, modelId, providerId, 0, tracker.rpm.resetAt);
    }
    if (now >= tracker.tpm.resetAt) {
      tracker.tpm.count = 0;
      tracker.tpm.resetAt = now + 60 * 1000;
      await updateTpmCount(keyId, modelId, providerId, 0, tracker.tpm.resetAt);
    }
    if (now >= tracker.rpd.resetAt) {
      tracker.rpd.count = 0;
      const rpdReset = getRpdResetTime(tracker.limits.rpdResetHour, tracker.limits.resetTz);
      tracker.rpd.resetAt = rpdReset.getTime();
      await updateRpdCount(keyId, modelId, providerId, 0, tracker.rpd.resetAt);
    }

    tracker.rpd.count += 1;
    await updateRpdCount(keyId, modelId, providerId, tracker.rpd.count, tracker.rpd.resetAt);

    return {
      rpm: { used: tracker.rpm.count, limit: tracker.limits.rpm, resetAt: tracker.rpm.resetAt },
      tpm: { used: tracker.tpm.count, limit: tracker.limits.tpm, resetAt: tracker.tpm.resetAt },
      rpd: { used: tracker.rpd.count, limit: tracker.limits.rpd, resetAt: tracker.rpd.resetAt },
    };
  }

  async recordRateLimitHit(keyId, modelId, providerId) {
    if (!keyId || keyId === "noauth") return { rateLimitedUntil: 0 };
    const tracker = await this.getModelTracker(keyId, modelId, providerId);
    const now = Date.now();
    const limits = getModelRateLimits(providerId, modelId);
    const rpdReset = getRpdResetTime(limits.rpdResetHour, limits.resetTz);
    tracker.rateLimitedUntil = rpdReset.getTime();
    await updateRateLimitedUntil(keyId, modelId, providerId, tracker.rateLimitedUntil);
    return { rateLimitedUntil: tracker.rateLimitedUntil };
  }

  async isRateLimited(keyId, modelId, providerId) {
    if (!keyId || keyId === "noauth") return false;
    await this._ensureDbInitialized();
    const keyTracker = this.trackers.get(keyId);
    if (!keyTracker) return false;
    const tracker = keyTracker.get(modelId);
    if (!tracker) return false;
    const now = Date.now();
    return (tracker.rateLimitedUntil > now) || (tracker.manualBlockUntil > now);
  }

  async recordManualBlock(keyId, modelId, providerId) {
    if (!keyId || keyId === "noauth") return { manualBlockUntil: 0 };
    const tracker = await this.getModelTracker(keyId, modelId, providerId);
    // Block until next RPD reset (same duration, but explicitly marked as manual)
    const limits = getModelRateLimits(providerId, modelId);
    const rpdReset = getRpdResetTime(limits.rpdResetHour, limits.resetTz);
    tracker.manualBlockUntil = rpdReset.getTime();
    await updateManualBlockUntil(keyId, modelId, providerId, tracker.manualBlockUntil);
    return { manualBlockUntil: tracker.manualBlockUntil };
  }

  async clearManualBlock(keyId, modelId, providerId) {
    const tracker = await this.getModelTracker(keyId, modelId, providerId);
    tracker.manualBlockUntil = 0;
    await updateManualBlockUntil(keyId, modelId, providerId, 0);
    return true;
  }

  async resetLimits(keyId, modelId, providerId) {
    const keyTracker = this.trackers.get(keyId);
    const pid = providerId || keyTracker?.get(modelId)?.providerId || "";
    if (keyTracker) {
      keyTracker.delete(modelId);
    }
    try {
      await deleteRateLimit(keyId, modelId, pid);
    } catch (e) {
      console.warn("[RATE_LIMIT_TRACKER] Failed to delete persisted limits:", e.message);
    }
    return true;
  }

  async setRpdCount(keyId, modelId, providerId, count) {
    const tracker = await this.getModelTracker(keyId, modelId, providerId);
    tracker.rpd.count = Math.max(0, Math.floor(count));
    await updateRpdCount(keyId, modelId, providerId, tracker.rpd.count, tracker.rpd.resetAt);
    return true;
  }

  async setRpmCount(keyId, modelId, providerId, count) {
    const tracker = await this.getModelTracker(keyId, modelId, providerId);
    tracker.rpm.count = Math.max(0, Math.floor(count));
    await updateRpmCount(keyId, modelId, providerId, tracker.rpm.count, tracker.rpm.resetAt);
    return true;
  }

  async setTpmCount(keyId, modelId, providerId, count) {
    const tracker = await this.getModelTracker(keyId, modelId, providerId);
    tracker.tpm.count = Math.max(0, Math.floor(count));
    await updateTpmCount(keyId, modelId, providerId, tracker.tpm.count, tracker.tpm.resetAt);
    return true;
  }

  async clearCooldown(keyId, modelId, providerId) {
    const tracker = await this.getModelTracker(keyId, modelId, providerId);
    tracker.rateLimitedUntil = 0;
    await updateRateLimitedUntil(keyId, modelId, providerId, 0);
    return true;
  }

  async cleanup() {
    const now = Date.now();
    for (const [keyId, keyTracker] of this.trackers.entries()) {
      for (const [modelId, tracker] of keyTracker.entries()) {
        const latestReset = Math.max(tracker.rpm.resetAt, tracker.tpm.resetAt, tracker.rpd.resetAt, tracker.rateLimitedUntil || 0, tracker.manualBlockUntil || 0);
        if (now > latestReset + 5 * 60 * 1000) {
          keyTracker.delete(modelId);
        }
      }
      if (keyTracker.size === 0) {
        this.trackers.delete(keyId);
      }
    }
    try {
      await cleanupExpiredRateLimits(now);
    } catch (e) {
      console.warn("[RATE_LIMIT_TRACKER] Cleanup expired rate limits failed:", e.message);
    }
  }

  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Rate Limit Tracker v2.0 - Per-key per-model with persistent RPD (survives restarts), 429 cooldown; RPD counts only successful responses
const GLOBAL_KEY = "__hydrarouter_rateLimitTracker__";
export const rateLimitTracker = (globalThis[GLOBAL_KEY] ??= new RateLimitTracker());
export const RATE_LIMIT_TRACKER_VERSION = "2.0";
if (!globalThis.__hydrarouter_rlt_logged) {
  globalThis.__hydrarouter_rlt_logged = true;
  console.log("[RATE_LIMIT_TRACKER] v2.0 loaded - per-key per-model with persistent RPD, 429 cooldown, RPD=success only");
}

export async function checkAndRecordRateLimit(connectionId, modelStr, estimatedTokens = 0) {
  const slashIndex = modelStr.indexOf("/");
  if (slashIndex === -1) return { allowed: true };
  
  const providerId = modelStr.slice(0, slashIndex);
  const modelId = modelStr.slice(slashIndex + 1);
  
  const check = await rateLimitTracker.checkLimit(connectionId, modelId, providerId, estimatedTokens);
  
  if (!check.allowed) {
    const waitMs = check.retryAfterMs;
    const waitSec = Math.ceil(waitMs / 1000);
    return {
      allowed: false,
      retryAfterMs: waitMs,
      message: `Rate limit exceeded for ${modelStr} (${check.reason}). Retry after ${waitSec}s.`,
      limits: check.limits,
    };
  }
  
  const usage = await rateLimitTracker.recordRequest(connectionId, modelId, providerId, estimatedTokens);
  
  return { allowed: true, usage };
}