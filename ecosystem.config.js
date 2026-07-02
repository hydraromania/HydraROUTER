module.exports = {
  apps: [
    {
      name: "hydrarouter",
      script: "./.next/standalone/server.js",
      cwd: "/root/hydrarouter",
      env: {
        NODE_ENV: "production",
        PORT: "20128",
        HOSTNAME: "0.0.0.0",
        DATA_DIR: "/root/.hydrarouter",
      },
      env_file: ".env",
      max_restarts: 5,
      restart_delay: 3000,
      max_memory_restart: "2G",
    },
  ],
};
