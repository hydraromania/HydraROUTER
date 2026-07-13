module.exports = {
  apps: [
    {
      name: "hydrarouter",
      script: "./start-pm2.js",
      cwd: "/root/hydrarouter",
      env: {
        NODE_ENV: "production",
        PORT: "4400",
        HOSTNAME: "0.0.0.0",
        DATA_DIR: "/root/.hydrarouter",
      },
      max_restarts: 5,
      restart_delay: 3000,
      max_memory_restart: "2G",
      // Keep process alive long enough to reset restart counter once stable
      min_uptime: 10000,
      // Graceful shutdown — give in-flight requests time to finish
      kill_timeout: 5000,
      // Fork mode (not cluster) — SQLite is single-writer
      instances: 1,
      exec_mode: "fork",
      // Log date stamps for debugging
      time: true,
    },
  ],
};
