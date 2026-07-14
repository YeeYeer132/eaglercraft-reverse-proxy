import { ReverseProxyConfig } from "./ReverseProxy.js";

/**
 * 反向代理配置
 *
 * 请根据你的需求修改以下配置
 */
export const config: ReverseProxyConfig = {
  // TCP 服务器配置 (原版 Minecraft 客户端连接这里)
  tcpHost: "0.0.0.0", // 监听所有网络接口
  tcpPort: 25565,      // Minecraft 默认端口

  // Eaglercraft 服务器地址 (WebSocket URL)
  // 示例: "ws://localhost:8081" 或 "wss://eaglercraft.example.com"
  // 请修改为你要连接的 Eaglercraft 服务器地址
  eaglerServer: "wss://your-eagler-server.com",

  // 最大玩家数量
  maxPlayers: 20,

  // 默认内置皮肤 ID (0-15)
  defaultSkinId: 0,

  // 调试模式
  debug: true,
};

/**
 * 从环境变量加载配置 (可选)
 */
export function loadConfigFromEnv(): Partial<ReverseProxyConfig> {
  return {
    tcpHost: process.env.REVERSE_PROXY_HOST,
    tcpPort: process.env.REVERSE_PROXY_PORT ? parseInt(process.env.REVERSE_PROXY_PORT) : undefined,
    eaglerServer: process.env.EAGLER_SERVER_URL,
    maxPlayers: process.env.MAX_PLAYERS ? parseInt(process.env.MAX_PLAYERS) : undefined,
    debug: process.env.DEBUG === "true",
  };
}

/**
 * 合并配置
 */
export function getConfig(): ReverseProxyConfig {
  const envConfig = loadConfigFromEnv();
  return {
    ...config,
    ...envConfig,
    tcpHost: envConfig.tcpHost ?? config.tcpHost,
    tcpPort: envConfig.tcpPort ?? config.tcpPort,
    eaglerServer: envConfig.eaglerServer ?? config.eaglerServer,
    maxPlayers: envConfig.maxPlayers ?? config.maxPlayers,
    defaultSkinId: config.defaultSkinId,
    debug: envConfig.debug ?? config.debug,
  };
}