import EventEmitter from "events";
import mcp, { createServer, Server, states } from "minecraft-protocol";
import { Logger } from "../logger.js";
import { EaglerClient, EaglerClientOptions } from "./EaglerClient.js";
import { ReverseEnums } from "./Enums.js";

const { createSerializer, createDeserializer } = mcp;

export interface ReverseProxyConfig {
  tcpHost: string;
  tcpPort: number;
  eaglerServer: string;
  maxPlayers: number;
  defaultSkinId: number;
  debug: boolean;
}

export interface ConnectedPlayer {
  username: string;
  uuid: string;
  eaglerClient: EaglerClient;
  mcClient: any;
}

// Eaglercraft 自定义包过滤
// 注意：Minecraft 1.8.9 协议中：
//   0x04 = Entity Equipment (实体装备) - 不能过滤！
//   0x05 = Entity Metadata (实体元数据) - 不能过滤！
//   0x06 = Entity Velocity (实体速度) - 不能过滤！
// Eaglercraft 的皮肤包使用不同的频道，不需要过滤 ID

// 只过滤频道消息中的皮肤相关频道
// 这些频道通过 0x17 (CSChannelMessage) 和 0x3f (SCChannelMessage) 发送
// 暂时不过滤，让客户端自己处理

/**
 * 反向代理
 * 接收原版 Minecraft 客户端连接，转发到 Eaglercraft WebSocket 服务器
 */
export class ReverseProxy extends EventEmitter {
  private config: ReverseProxyConfig;
  private logger: Logger;
  private mcServer: Server | null = null;
  private players: Map<string, ConnectedPlayer> = new Map();

  constructor(config: ReverseProxyConfig) {
    super();
    this.config = config;
    this.logger = new Logger("ReverseProxy");
  }

  async start(): Promise<void> {
    this.logger.info("Starting Reverse Proxy...");
    this.logger.info(`TCP Server: ${this.config.tcpHost}:${this.config.tcpPort}`);
    this.logger.info(`Eaglercraft Server: ${this.config.eaglerServer}`);

    this.mcServer = createServer({
      host: this.config.tcpHost,
      port: this.config.tcpPort,
      motd: "§6Eaglercraft Reverse Proxy§r\n§7Connect with vanilla MC 1.8.9",
      "online-mode": false,
      version: "1.8.9",
      maxPlayers: this.config.maxPlayers,
    });

    this.mcServer.on("login", async (mcClient: any) => {
      await this.handlePlayerConnect(mcClient);
    });

    this.mcServer.on("error", (err: Error) => {
      this.logger.error(`Server error: ${err.message}`);
    });

    this.logger.info("Reverse Proxy started successfully!");
    this.emit("started");
  }

  private async handlePlayerConnect(mcClient: any): Promise<void> {
    const username = mcClient.username;
    this.logger.info(`Player ${username} is connecting...`);

    if (this.players.size >= this.config.maxPlayers) {
      mcClient.end("§cServer is full!");
      return;
    }

    if (this.players.has(username)) {
      mcClient.end("§cYou are already connected!");
      return;
    }

    try {
      const eaglerClient = new EaglerClient({
        wsUrl: this.config.eaglerServer,
        username: username,
        skinType: ReverseEnums.SkinType.BUILTIN,
        skinData: this.config.defaultSkinId,
      });

      this.logger.info(`[${username}] Connecting to Eaglercraft server...`);
      const result = await eaglerClient.connect();

      if (!result.success) {
        this.logger.error(`[${username}] Failed to connect: ${result.error}`);
        mcClient.end(`§cFailed to connect: ${result.error}`);
        return;
      }

      this.logger.info(`[${username}] Connected! UUID: ${eaglerClient.uuid}`);

      const player: ConnectedPlayer = {
        username,
        uuid: eaglerClient.uuid,
        eaglerClient,
        mcClient,
      };
      this.players.set(username, player);

      await this.setupPacketForwarding(player);
      this.emit("playerConnect", player);

    } catch (err) {
      this.logger.error(`[${username}] Connection error: ${(err as Error).message}`);
      mcClient.end(`§cConnection error: ${(err as Error).message}`);
    }
  }

  private async setupPacketForwarding(player: ConnectedPlayer): Promise<void> {
    const { mcClient, eaglerClient } = player;
    const debug = this.config.debug;

    // 客户端序列化器
    const clientSerializer = createSerializer({
      state: states.PLAY,
      isServer: false,
      version: "1.8.9",
      customPackets: null,
    });

    // 统计计数器
    let packetsToServer = 0;
    let packetsToClient = 0;
    let lastStatsTime = Date.now();
    let loginSent = false;

    // Minecraft 客户端 → Eaglercraft 服务器
    mcClient.on("packet", (packet: any, meta: any) => {
      if (meta.state !== states.PLAY) return;

      try {
        const buffer = clientSerializer.createPacketBuffer({
          name: meta.name,
          params: packet,
        });
        eaglerClient.sendRaw(buffer);
        packetsToServer++;

        if (debug && packetsToServer % 100 === 0) {
          this.logger.debug(`[${player.username}] Sent ${packetsToServer} packets to server`);
        }
      } catch (err) {
        if (debug) {
          this.logger.debug(`[${player.username}] Packet error: ${(err as Error).message}`);
        }
      }
    });

    // Eaglercraft 服务器 → Minecraft 客户端
    eaglerClient.on("packet", (data: Buffer) => {
      const packetId = data[0];

      // 检查是否是断开包 (0x40 在 1.8.9 是 kick_disconnect)
      if (packetId === 0x40) {
        try {
          // 解析断开原因
          let reason = "Unknown";
          try {
            const reasonData = data.slice(1);
            // 尝试读取字符串
            const len = reasonData.readUInt8(0);
            if (len < 128 && reasonData.length > len) {
              reason = reasonData.slice(1, 1 + len).toString('utf8');
              try {
                const json = JSON.parse(reason);
                reason = json.text || json.translate || reason;
              } catch {}
            }
          } catch {}
          this.logger.warn(`[${player.username}] Server kicked: ${reason}`);
        } catch {}
      }

      // 直接转发所有数据包，不再过滤
      try {
        mcClient.writeRaw(data);
        packetsToClient++;

        if (!loginSent) {
          loginSent = true;
          this.logger.info(`[${player.username}] Login complete, stream started`);
        }

        if (debug && packetsToClient % 100 === 0) {
          this.logger.debug(`[${player.username}] Received ${packetsToClient} packets from server`);
        }
      } catch (err) {
        if (debug) {
          this.logger.debug(`[${player.username}] Packet forward error: ${(err as Error).message}`);
        }
      }
    });

    // 定期打印统计
    const statsInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastStatsTime;
      if (elapsed >= 30000 && (packetsToServer > 0 || packetsToClient > 0)) {
        this.logger.info(`[${player.username}] Stats: ${packetsToServer} packets sent, ${packetsToClient} packets received`);
        lastStatsTime = now;
      }
    }, 30000);

    // 断开连接处理
    mcClient.on("end", () => {
      clearInterval(statsInterval);
      this.logger.info(`[${player.username}] Disconnected from MC client`);
      eaglerClient.disconnect();
      this.players.delete(player.username);
      this.emit("playerDisconnect", player);
    });

    eaglerClient.on("disconnected", () => {
      clearInterval(statsInterval);
      this.logger.info(`[${player.username}] Disconnected from Eaglercraft server`);
      mcClient.end("§cLost connection to Eaglercraft server");
      this.players.delete(player.username);
      this.emit("playerDisconnect", player);
    });

    eaglerClient.on("error", (err: Error) => {
      clearInterval(statsInterval);
      this.logger.error(`[${player.username}] Error: ${err.message}`);
      mcClient.end(`§cError: ${err.message}`);
      this.players.delete(player.username);
    });
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping Reverse Proxy...");

    for (const player of this.players.values()) {
      player.mcClient.end("§cProxy is shutting down");
      player.eaglerClient.disconnect();
    }
    this.players.clear();

    if (this.mcServer) {
      this.mcServer.close();
      this.mcServer = null;
    }

    this.logger.info("Reverse Proxy stopped");
    this.emit("stopped");
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  getPlayers(): ConnectedPlayer[] {
    return Array.from(this.players.values());
  }
}