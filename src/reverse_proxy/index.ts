import { ReverseProxy } from "./ReverseProxy.js";
import { getConfig } from "./config.js";
import { Logger, verboseLogging } from "../logger.js";

const logger = new Logger("ReverseProxyLauncher");

/**
 * 反向代理启动入口
 *
 * 用法:
 *   1. 修改 config.ts 中的配置
 *   2. 编译: tsc
 *   3. 运行: node build/reverse_proxy/index.js
 */
async function main() {
  logger.info("=".repeat(50));
  logger.info("  Eaglercraft Reverse Proxy");
  logger.info("  Minecraft Client → Eaglercraft Server");
  logger.info("=".repeat(50));

  const config = getConfig();
  verboseLogging(config.debug);

  logger.info("Configuration:");
  logger.info(`  TCP Listen: ${config.tcpHost}:${config.tcpPort}`);
  logger.info(`  Eaglercraft Server: ${config.eaglerServer}`);
  logger.info(`  Max Players: ${config.maxPlayers}`);
  logger.info(`  Debug Mode: ${config.debug}`);
  logger.info("");

  const proxy = new ReverseProxy(config);

  // 监听事件
  proxy.on("started", () => {
    logger.info("✓ Reverse proxy is now running!");
    logger.info("Connect with your Minecraft 1.8.9 client to start playing.");
  });

  proxy.on("playerConnect", (player) => {
    logger.info(`→ Player connected: ${player.username} (${player.uuid})`);
  });

  proxy.on("playerDisconnect", (player) => {
    logger.info(`← Player disconnected: ${player.username}`);
  });

  proxy.on("stopped", () => {
    logger.info("Reverse proxy has stopped.");
  });

  // 处理关闭信号
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down...");
    await proxy.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down...");
    await proxy.stop();
    process.exit(0);
  });

  // 处理未捕获的异常
  process.on("uncaughtException", (err) => {
    logger.error(`Uncaught exception: ${err.stack || err.message}`);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });

  // 启动代理
  try {
    await proxy.start();
  } catch (err) {
    logger.error(`Failed to start reverse proxy: ${(err as Error).stack || (err as Error).message}`);
    process.exit(1);
  }
}

// 启动
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});