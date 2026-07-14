import EventEmitter from "events";
import mcp, { createServer, Server, states } from "minecraft-protocol";
import { Logger } from "../logger.js";
import { EaglerClient } from "./EaglerClient.js";
import { ReverseEnums } from "./Enums.js";
import { MineProtocol } from "../proxy/Protocol.js";

const { createSerializer } = mcp;

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

/**
 * 反向代理 - 高性能版本
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
    this.logger.info("Starting Eaglercraft Reverse Proxy...");
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

      this.setupPacketForwarding(player);
      this.emit("playerConnect", player);

    } catch (err) {
      this.logger.error(`[${username}] Connection error: ${(err as Error).message}`);
      mcClient.end(`§cConnection error: ${(err as Error).message}`);
    }
  }

  /**
   * 高性能数据包转发
   * 优化：减少对象创建、避免阻塞事件循环
   */
  private setupPacketForwarding(player: ConnectedPlayer): void {
    const { mcClient, eaglerClient } = player;
    const debug = this.config.debug;

    // 预创建序列化器，避免重复创建
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

    // 高频数据包名称缓存（避免字符串比较）
    const highFrequencyPackets = new Set([
      'flying', 'look', 'position', 'position_look', 'keep_alive', 'arm_animation'
    ]);

    // ================================
    // Minecraft 客户端 → Eaglercraft 服务器
    // 优化：跳过高频数据包的调试日志
    // ================================
    mcClient.on("packet", (packet: any, meta: any) => {
      if (meta.state !== states.PLAY) return;

      try {
        const buffer = clientSerializer.createPacketBuffer({
          name: meta.name,
          params: packet,
        });
        eaglerClient.sendRaw(buffer);
        packetsToServer++;

        // 只在 debug 模式下记录非高频数据包
        if (debug && !highFrequencyPackets.has(meta.name)) {
          this.logger.debug(`[${player.username}] C->S: ${meta.name}`);
        }
      } catch (err) {
        if (debug) {
          this.logger.debug(`[${player.username}] Encode error: ${(err as Error).message}`);
        }
      }
    });

    // ================================
    // Eaglercraft 服务器 → Minecraft 客户端
    // 优化：直接转发，最小化处理开销
    // ================================
    eaglerClient.on("packet", (data: Buffer) => {
      const packetId = data[0];

      // 断开包处理 (0x40 = kick_disconnect)
      if (packetId === 0x40) {
        try {
          const reason = this.parseKickPacket(data);
          this.logger.warn(`[${player.username}] Server kicked: ${reason}`);
        } catch {}
      }

      // 直接转发，不做任何处理
      try {
        mcClient.writeRaw(data);
        packetsToClient++;
      } catch (err) {
        if (debug) {
          this.logger.debug(`[${player.username}] Forward error: ${(err as Error).message}`);
        }
      }
    });

    // 统计输出（降低频率到 60 秒）
    const statsInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastStatsTime;
      if (elapsed >= 60000 && (packetsToServer > 0 || packetsToClient > 0)) {
        this.logger.info(`[${player.username}] Stats: ${packetsToServer} sent, ${packetsToClient} received`);
        lastStatsTime = now;
      }
    }, 60000);

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

  /**
   * 解析踢人包
   */
  private parseKickPacket(data: Buffer): string {
    try {
      data = data.subarray(1);
      const reason = MineProtocol.readString(data);
      let message = reason.value;

      try {
        const json = JSON.parse(message);
        if (json.text) message = json.text;
        else if (json.translate) message = json.translate;
      } catch {}

      return message;
    } catch {
      return "Unknown reason";
    }
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