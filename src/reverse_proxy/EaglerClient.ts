import WebSocket from "ws";
import EventEmitter from "events";
import { Logger } from "../logger.js";
import { ReverseEnums } from "./Enums.js";

// 从主模块导入协议工具
import { MineProtocol } from "../proxy/Protocol.js";
import { Util } from "../proxy/Util.js";
import { Constants } from "../proxy/Constants.js";
import { NETWORK_VERSION, VANILLA_PROTOCOL_VERSION } from "../meta.js";

export interface EaglerClientOptions {
  wsUrl: string;
  username: string;
  skinType?: ReverseEnums.SkinType;
  skinData?: Buffer | number; // Buffer for custom, number for builtin
}

export interface HandshakeResult {
  success: boolean;
  uuid: string;
  serverBrand: string;
  serverVersion: string;
  error?: string;
}

/**
 * Eaglercraft WebSocket 客户端
 * 处理与 Eaglercraft 服务器的 WebSocket 连接
 */
export class EaglerClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private logger: Logger;
  private username: string;
  private wsUrl: string;
  private skinType: ReverseEnums.SkinType;
  private skinData: Buffer | number;

  public uuid: string = "";
  public state: ReverseEnums.ConnectionState = ReverseEnums.ConnectionState.DISCONNECTED;
  public serverBrand: string = "";
  public serverVersion: string = "";

  constructor(options: EaglerClientOptions) {
    super();
    this.logger = new Logger("EaglerClient");
    this.username = options.username;
    this.wsUrl = options.wsUrl;
    this.skinType = options.skinType ?? ReverseEnums.SkinType.BUILTIN;
    this.skinData = options.skinData ?? 0;
  }

  /**
   * 连接到 Eaglercraft 服务器并完成握手
   */
  async connect(): Promise<HandshakeResult> {
    return new Promise((resolve, reject) => {
      this.state = ReverseEnums.ConnectionState.HANDSHAKING;

      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", async () => {
        this.logger.info(`WebSocket connected to ${this.wsUrl}`);
        try {
          const result = await this.performHandshake();
          if (result.success) {
            this.state = ReverseEnums.ConnectionState.CONNECTED;
            this.emit("connected");
          }
          resolve(result);
        } catch (err) {
          this.state = ReverseEnums.ConnectionState.DISCONNECTED;
          resolve({
            success: false,
            uuid: "",
            serverBrand: "",
            serverVersion: "",
            error: (err as Error).message,
          });
        }
      });

      this.ws.on("error", (err) => {
        this.logger.error(`WebSocket error: ${err.message}`);
        this.state = ReverseEnums.ConnectionState.DISCONNECTED;
        this.emit("error", err);
        reject(err);
      });

      this.ws.on("close", () => {
        this.logger.info("WebSocket connection closed");
        this.state = ReverseEnums.ConnectionState.DISCONNECTED;
        this.emit("disconnected");
      });

      // 处理游戏数据包 (握手完成后)
      this.ws.on("message", (data: Buffer) => {
        if (this.state === ReverseEnums.ConnectionState.CONNECTED) {
          this.emit("packet", data);
        }
      });
    });
  }

  /**
   * 执行 Eaglercraft 握手协议
   */
  private async performHandshake(): Promise<HandshakeResult> {
    // 步骤 1: 发送登录包
    await this.sendLoginPacket();

    // 步骤 2: 等待服务端标识包
    const identifyPkt = await this.waitForPacket(ReverseEnums.PacketId.SCIdentifyPacket);
    const identifyData = this.parseIdentifyPacket(identifyPkt);
    this.serverBrand = identifyData.brand;
    this.serverVersion = identifyData.version;
    this.logger.info(`Server identified: ${this.serverBrand} v${this.serverVersion}`);

    // 步骤 3: 发送用户名包
    await this.sendUsernamePacket();

    // 步骤 4: 等待 UUID 同步包
    const uuidPkt = await this.waitForPacket(ReverseEnums.PacketId.SCSyncUuidPacket);
    const uuidData = this.parseUuidPacket(uuidPkt);
    this.uuid = uuidData.uuid;
    this.logger.info(`Assigned UUID: ${this.uuid}`);

    // 步骤 5: 发送皮肤包
    await this.sendSkinPacket();

    // 步骤 6: 发送就绪包
    await this.sendReadyPacket();

    // 步骤 7: 等待服务端就绪
    await this.waitForPacket(ReverseEnums.PacketId.SCReadyPacket);
    this.logger.info("Handshake completed successfully!");

    return {
      success: true,
      uuid: this.uuid,
      serverBrand: this.serverBrand,
      serverVersion: this.serverVersion,
    };
  }

  /**
   * 发送登录包
   */
  private sendLoginPacket(): Promise<void> {
    return new Promise((resolve) => {
      const packet = Buffer.concat([
        Buffer.from([ReverseEnums.PacketId.CSLoginPacket]),
        Buffer.from([0x02]), // 固定字节
        MineProtocol.writeShort(0x01),
        MineProtocol.writeShort(NETWORK_VERSION),
        MineProtocol.writeShort(0x01),
        MineProtocol.writeShort(VANILLA_PROTOCOL_VERSION),
        MineProtocol.writeString("EaglerReverseProxy"), // 品牌
        MineProtocol.writeString("1.0.0"), // 版本
        Buffer.from([0x00]),
        MineProtocol.writeString(this.username),
      ]);

      this.ws!.send(packet);
      this.logger.debug("Sent login packet");
      resolve();
    });
  }

  /**
   * 发送用户名包
   */
  private sendUsernamePacket(): Promise<void> {
    return new Promise((resolve) => {
      const packet = Buffer.concat([
        Buffer.from([ReverseEnums.PacketId.CSUsernamePacket]),
        MineProtocol.writeString(this.username),
        MineProtocol.writeString("default"),
        Buffer.from([0x00]),
      ]);

      this.ws!.send(packet);
      this.logger.debug("Sent username packet");
      resolve();
    });
  }

  /**
   * 发送皮肤包
   */
  private sendSkinPacket(): Promise<void> {
    return new Promise((resolve) => {
      let packet: Buffer;

      if (this.skinType === ReverseEnums.SkinType.BUILTIN) {
        // 使用内置皮肤
        const skinId = typeof this.skinData === "number" ? this.skinData : 0;
        packet = Buffer.concat([
          Buffer.from([ReverseEnums.PacketId.CSSetSkinPacket]),
          MineProtocol.writeString("skin_v1"),
          Buffer.from(Constants.MAGIC_ENDING_CLIENT_UPLOAD_SKIN_BUILTIN),
          Buffer.from([skinId]),
        ]);
        this.logger.debug(`Sent skin packet (builtin, id=${skinId})`);
      } else {
        // 自定义皮肤 (64x64 PNG)
        const skinBuffer = this.skinData as Buffer;
        packet = Buffer.concat([
          Buffer.from([ReverseEnums.PacketId.CSSetSkinPacket]),
          MineProtocol.writeString("skin_v1"),
          MineProtocol.writeVarInt(0), // 维度
          Buffer.from([0x00, 0x00, 0x00]), // 填充
          skinBuffer.slice(0, 16384), // 64x64x4 = 16384 bytes
        ]);
        this.logger.debug("Sent skin packet (custom)");
      }

      this.ws!.send(packet);
      resolve();
    });
  }

  /**
   * 发送就绪包
   */
  private sendReadyPacket(): Promise<void> {
    return new Promise((resolve) => {
      const packet = Buffer.from([ReverseEnums.PacketId.CSReadyPacket]);
      this.ws!.send(packet);
      this.logger.debug("Sent ready packet");
      resolve();
    });
  }

  /**
   * 等待特定类型的包
   */
  private waitForPacket(packetId: ReverseEnums.PacketId, timeout = 30000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws!.removeListener("message", handler);
        this.logger.error(`Timeout waiting for packet 0x${packetId.toString(16)}`);
        reject(new Error(`Timeout waiting for packet 0x${packetId.toString(16)}`));
      }, timeout);

      const handler = (data: Buffer) => {
        const receivedId = data[0];
        this.logger.debug(`Received packet: 0x${receivedId.toString(16)} (expecting: 0x${packetId.toString(16)})`);
        
        // 如果收到断开包，立即失败
        if (receivedId === ReverseEnums.PacketId.SCDisconnectPacket) {
          clearTimeout(timer);
          this.ws!.removeListener("message", handler);
          const reason = this.parseDisconnectPacket(data);
          this.logger.error(`Server disconnected: ${reason}`);
          reject(new Error(`Server disconnected: ${reason}`));
          return;
        }
        
        if (receivedId === packetId) {
          clearTimeout(timer);
          this.ws!.removeListener("message", handler);
          resolve(data);
        }
      };

      this.ws!.on("message", handler);
    });
  }

  /**
   * 解析断开连接包
   */
  private parseDisconnectPacket(data: Buffer): string {
    try {
      // 跳过包 ID
      data = data.subarray(1);
      // 读取断开原因
      const reason = MineProtocol.readString(data);
      let message = reason.value;
      
      // 尝试解析 JSON 格式的消息
      try {
        const json = JSON.parse(message);
        if (json.text) {
          message = json.text;
        } else if (json.translate) {
          message = json.translate;
        }
      } catch {
        // 不是 JSON，直接返回原始消息
      }
      
      return message;
    } catch {
      return "Unknown reason";
    }
  }

  /**
   * 解析服务端标识包
   */
  private parseIdentifyPacket(data: Buffer): { brand: string; version: string } {
    data = data.subarray(1); // 跳过包 ID
    const protoVer = MineProtocol.readShort(data);
    const gameVer = MineProtocol.readShort(protoVer.newBuffer);
    const brand = MineProtocol.readString(gameVer.newBuffer);
    const version = MineProtocol.readString(brand.newBuffer);
    return {
      brand: brand.value,
      version: version.value,
    };
  }

  /**
   * 解析 UUID 同步包
   */
  private parseUuidPacket(data: Buffer): { username: string; uuid: string } {
    data = data.subarray(1); // 跳过包 ID
    const username = MineProtocol.readString(data);
    const uuidBuffer = username.newBuffer.subarray(0, 16);
    const uuid = Util.uuidBufferToString(uuidBuffer);
    return {
      username: username.value,
      uuid: uuid,
    };
  }

  /**
   * 发送原始数据包到 Eaglercraft 服务器
   */
  sendRaw(data: Buffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /**
   * 发送 Minecraft 协议数据包 (转换为 Eaglercraft 格式)
   */
  sendMinecraftPacket(name: string, params: any): void {
    // 这里需要根据包类型进行转换
    // 游戏数据包通常直接转发
    this.emit("outgoingPacket", { name, params });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = ReverseEnums.ConnectionState.DISCONNECTED;
  }
}