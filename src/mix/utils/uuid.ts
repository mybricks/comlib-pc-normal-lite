/** 生成简单的随机 UUID（兼容浏览器和 Node 环境） */
export function randomUUID(len?: number): string {
  let uuid = ''
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    uuid = crypto.randomUUID();
  } else {
    // fallback: RFC 4122 v4
    uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  return len ? uuid.slice(0, len) : uuid
}
