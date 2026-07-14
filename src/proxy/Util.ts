import { createHash } from "crypto";
import { encodeULEB128, decodeULEB128 } from "@thi.ng/leb128";

export namespace Util {
  export const encodeVarInt: typeof encodeULEB128 = encodeULEB128;
  export const decodeVarInt: typeof decodeULEB128 = decodeULEB128;

  // 从用户名生成离线 UUID
  export function generateUUIDFromPlayer(user: string): string {
    const str = `OfflinePlayer:${user}`;
    let md5Bytes = createHash("md5").update(str).digest();
    md5Bytes[6] &= 0x0f; /* clear version        */
    md5Bytes[6] |= 0x30; /* set to version 3     */
    md5Bytes[8] &= 0x3f; /* clear variant        */
    md5Bytes[8] |= 0x80; /* set to IETF variant  */
    return uuidBufferToString(md5Bytes);
  }

  // UUID 字符串转 Buffer
  export function uuidStringToBuffer(uuid: string): Buffer {
    if (!uuid) return Buffer.alloc(16);
    const hexStr = uuid.replace(/-/g, "");
    if (uuid.length != 36 || hexStr.length != 32) throw new Error(`Invalid UUID string: ${uuid}`);
    return Buffer.from(hexStr, "hex");
  }

  // UUID Buffer 转字符串
  export function uuidBufferToString(buffer: Buffer): string {
    if (buffer.length != 16) throw new Error(`Invalid buffer length for uuid: ${buffer.length}`);
    if (buffer.equals(Buffer.alloc(16))) return null;
    const str = buffer.toString("hex");
    return `${str.slice(0, 8)}-${str.slice(8, 12)}-${str.slice(12, 16)}-${str.slice(16, 20)}-${str.slice(20)}`;
  }
}