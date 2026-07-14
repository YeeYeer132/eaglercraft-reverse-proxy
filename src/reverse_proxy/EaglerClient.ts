import WebSocket from "ws";
import EventEmitter from "events";
import { Logger } from "../logger.js";
import { ReverseEnums } from "./Enums.js";
import { MineProtocol } from "../proxy/Protocol.js";
import { Util } from "../proxy/Util.js";
import { Constants } from "../proxy/Constants.js";
import { NETWORK_VERSION, VANILLA_PROTOCOL_VERSION } from "../meta.js";

export interface EaglerClientOptions {
  wsUrl: string;
  username: string;
  skinType?: ReverseEnums.SkinType;
  skinData?: Buffer | number;
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
 * 完全按照 CSLoginPacket 格式实现握手
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

  async connect(): Promise<HandshakeResult> {
    return new Promise((resolve, reject) => {
      this.state = ReverseEnums.ConnectionState.HANDSHAKING;

      this.logger.info(`Connecting to ${this.wsUrl}...`);
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", async () => {
        this.logger.info("WebSocket connected, starting handshake...");
        try {
          const result = await this.performHandshake();
          if (result.success) {
            this.state = ReverseEnums.ConnectionState.CONNECTED;
            this.emit("connected");
          }
          resolve(result);
        } catch (err) {
          this.state = ReverseEnums.ConnectionState.DISCONNECTED;
          this.logger.error(`Handshake failed: ${(err as Error).message}`);
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

      this.ws.on("close", (code, reason) => {
        this.logger.info(`WebSocket closed: code=${code}, reason=${reason.toString()}`);
        this.state = ReverseEnums.ConnectionState.DISCONNECTED;
        this.emit("disconnected");
      });

      // 游戏数据包转发
      this.ws.on("message", (data: Buffer) => {
        if (this.state === ReverseEnums.ConnectionState.CONNECTED) {
          this.emit("packet", data);
        }
      });
    });
  }

  /**
   * 执行完整的 Eaglercraft 握手协议
   * 完全按照 CSLoginPacket.ts 的格式
   */
  private async performHandshake(): Promise<HandshakeResult> {
    // 步骤 1: 发送登录包 (CSLoginPacket)
    this.sendLoginPacket();

    // 步骤 2: 等待服务端标识包 (SCIdentifyPacket 0x02)
    const identifyPkt = await this.waitForPacket(ReverseEnums.PacketId.SCIdentifyPacket);
    const identifyData = this.parseIdentifyPacket(identifyPkt);
    this.serverBrand = identifyData.brand;
    this.serverVersion = identifyData.version;
    this.logger.info(`Server: ${this.serverBrand} v${this.serverVersion}`);

    // 步骤 3: 发送用户名包 (CSUsernamePacket 0x04)
    this.sendUsernamePacket();

    // 步骤 4: 等待 UUID 同步包 (SCSyncUuidPacket 0x05)
    const uuidPkt = await this.waitForPacket(ReverseEnums.PacketId.SCSyncUuidPacket);
    const uuidData = this.parseUuidPacket(uuidPkt);
    this.uuid = uuidData.uuid;
    this.logger.info(`UUID: ${this.uuid}`);

    // 步骤 5: 发送皮肤包 (CSSetSkinPacket 0x07)
    this.sendSkinPacket();

    // 步骤 6: 发送就绪包 (CSReadyPacket 0x08)
    this.sendReadyPacket();

    // 步骤 7: 等待服务端就绪 (SCReadyPacket 0x09)
    await this.waitForPacket(ReverseEnums.PacketId.SCReadyPacket);
    this.logger.info("Handshake complete!");

    return {
      success: true,
      uuid: this.uuid,
      serverBrand: this.serverBrand,
      serverVersion: this.serverVersion,
    };
  }

  /**
   * 发送登录包
   * 格式完全匹配 CSLoginPacket.serialize()
   */
  private sendLoginPacket(): void {
    // 按照 CSLoginPacket.ts 的格式
    const packet = Buffer.concat(
      [
        [ReverseEnums.PacketId.CSLoginPacket], // 0x01
        [0x02],                                  // 固定字节
        MineProtocol.writeShort(0x01),          // 协议版本前缀
        MineProtocol.writeShort(NETWORK_VERSION), // 0x03
        MineProtocol.writeShort(0x01),          // 游戏版本前缀
        MineProtocol.writeShort(VANILLA_PROTOCOL_VERSION), // 47
        MineProtocol.writeString("EaglerReverseProxy"), // 品牌
        MineProtocol.writeString("1.0.0"),     // 版本
        [0x00],                                 // 固定字节
        MineProtocol.writeString(this.username), // 用户名
      ].map((arr) => (arr instanceof Uint8Array ? arr : Buffer.from(arr)))
    );

    this.ws!.send(packet);
    this.logger.debug(`Sent login packet for ${this.username}`);
  }

  /**
   * 发送用户名包
   */
  private sendUsernamePacket(): void {
    const packet = Buffer.concat(
      [
        [ReverseEnums.PacketId.CSUsernamePacket],
        MineProtocol.writeString(this.username),
        MineProtocol.writeString("default"),
        [0x00],
      ].map((arr) => (arr instanceof Uint8Array ? arr : Buffer.from(arr)))
    );

    this.ws!.send(packet);
    this.logger.debug("Sent username packet");
  }

  /**
   * 发送皮肤包
   */
  private sendSkinPacket(): void {
    let packet: Buffer;

    if (this.skinType === ReverseEnums.SkinType.BUILTIN) {
      // 内置皮肤
      const skinId = typeof this.skinData === "number" ? this.skinData : 0;
      packet = Buffer.concat(
        [
          [ReverseEnums.PacketId.CSSetSkinPacket],
          MineProtocol.writeString("skin_v1"),
          Buffer.from(Constants.MAGIC_ENDING_CLIENT_UPLOAD_SKIN_BUILTIN),
          [skinId],
        ].map((arr) => (arr instanceof Uint8Array ? arr : Buffer.from(arr)))
      );
      this.logger.debug(`Sent skin packet (builtin id=${skinId})`);
    } else {
      // 自定义皮肤
      const skinBuffer = this.skinData as Buffer;
      packet = Buffer.concat(
        [
          [ReverseEnums.PacketId.CSSetSkinPacket],
          MineProtocol.writeString("skin_v1"),
          MineProtocol.writeVarInt(0),
          Buffer.from([0x00, 0x00, 0x00]),
          skinBuffer.slice(0, 16384),
        ].map((arr) => (arr instanceof Uint8Array ? arr : Buffer.from(arr)))
      );
      this.logger.debug("Sent skin packet (custom)");
    }

    this.ws!.send(packet);
  }

  /**
   * 发送就绪包
   */
  private sendReadyPacket(): void {
    const packet = Buffer.from([ReverseEnums.PacketId.CSReadyPacket]);
    this.ws!.send(packet);
    this.logger.debug("Sent ready packet");
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

        // 断开包处理
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
   * 解析断开包
   */
  private parseDisconnectPacket(data: Buffer): string {
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

  /**
   * 解析服务端标识包
   */
  private parseIdentifyPacket(data: Buffer): { brand: string; version: string } {
    data = data.subarray(1);
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
    data = data.subarray(1);
    const username = MineProtocol.readString(data);
    const uuidBuffer = username.newBuffer.subarray(0, 16);
    const uuid = Util.uuidBufferToString(uuidBuffer);
    return {
      username: username.value,
      uuid: uuid,
    };
  }

  /**
   * 发送原始数据
   */
  sendRaw(data: Buffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
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