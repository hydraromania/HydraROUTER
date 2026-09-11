export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    // Rehydrate persisted rate-limit & timeout overrides on server startup
    try {
      const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
      const { setModelLimitOverrides } = await import("open-sse/config/modelRateLimits.js");
      const settings = await getSettings();
      if (settings?.rateLimitOverrides) {
        setModelLimitOverrides(settings.rateLimitOverrides);
      }
    } catch {}
  }
}
