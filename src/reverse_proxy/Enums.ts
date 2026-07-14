// 反向代理专用枚举

export namespace ReverseEnums {
  export enum ConnectionState {
    DISCONNECTED = "DISCONNECTED",
    HANDSHAKING = "HANDSHAKING",
    CONNECTED = "CONNECTED",
  }

  export enum PacketId {
    // 客户端发送 (我们作为客户端发送给 Eaglercraft 服务器)
    CSLoginPacket = 0x01,
    CSUsernamePacket = 0x04,
    CSSetSkinPacket = 0x07,
    CSReadyPacket = 0x08,
    CSChannelMessagePacket = 0x17,

    // 服务端发送 (Eaglercraft 服务器发送给我们)
    SCIdentifyPacket = 0x02,
    SCSyncUuidPacket = 0x05,
    SCReadyPacket = 0x09,
    SCDisconnectPacket = 0xff,
    SCChannelMessagePacket = 0x3f,
  }

  export enum SkinType {
    BUILTIN = 0,
    CUSTOM = 1,
  }

  // 内置皮肤 ID
  export const BUILTIN_SKIN_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
}