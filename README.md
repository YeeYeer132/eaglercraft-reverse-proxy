# Eaglercraft Reverse Proxy

让原版 Minecraft 1.8.9 客户端连接 Eaglercraft WebSocket 服务器。

## 功能

- 将 Minecraft TCP 协议转换为 Eaglercraft WebSocket 协议
- 支持原版 Minecraft 1.8.9 客户端
- 自动处理握手、皮肤、KeepAlive 等
- 支持人人插

## 快速开始

### 环境要求

- Node.js 18+
- npm

### 安装

```bash
git clone https://github.com/你的用户名/eaglercraft-reverse-proxy.git
cd eaglercraft-reverse-proxy
npm install
```

### 配置

编辑 `src/reverse_proxy/config.ts`：

```typescript
export const config: ReverseProxyConfig = {
  tcpHost: "0.0.0.0",      // 监听地址
  tcpPort: 25565,          // 监听端口
  eaglerServer: "wss://你的服务器地址",  // Eaglercraft 服务器地址
  maxPlayers: 20,          // 最大玩家数
  defaultSkinId: 0,        // 默认皮肤 ID
  debug: false,            // 调试模式
};
```

### 运行

Windows:
```bash
build-and-run.bat
```

Linux/macOS:
```bash
npm run build
npm run start
```

### 连接

使用 Minecraft 1.8.9 客户端，服务器地址填写运行代理的机器 IP。

## 工作原理

```
┌──────────────────┐     TCP      ┌─────────────────┐    WebSocket    ┌────────────────────┐
│ Minecraft 1.8.9  │ ──────────→  │  ReverseProxy   │ ─────────────→ │  Eaglercraft 服务器 │
│   (原版客户端)     │              │ (本代理模块)     │                │   (WebSocket)      │
└──────────────────┘              └─────────────────┘                └────────────────────┘
```

## 已知问题

- 部分服务器的反作弊插件可能会误判
- 某些 Eaglercraft 特有功能可能不完全支持

## 许可证

MIT License

## 致谢

- [Eaglercraft](https://github.com/lax1dude/eaglerxserver) - Eaglercraft 服务器实现
- [minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol) - Minecraft 协议库
