import { createHmac, timingSafeEqual } from "crypto";

/**
 * 导出链接短时有效：使用 HMAC-SHA256 对 (userId|expiresAt) 签名。
 * 链接形如 /api/my-profit/products/export?uid=xxx&exp=1699999999999&sig=hex
 */
const TTL_MS = 5 * 60 * 1000; // 5 分钟

function secret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "wanying-dev-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** 生成短时导出令牌 */
export function makeExportToken(userId: string): { url: string; expiresAt: number } {
  const exp = Date.now() + TTL_MS;
  const payload = `${userId}|${exp}`;
  const sig = sign(payload);
  const url = `/api/my-profit/products/export?uid=${encodeURIComponent(userId)}&exp=${exp}&sig=${sig}`;
  return { url, expiresAt: exp };
}

/** 校验导出令牌 */
export function verifyExportToken(uid: string, exp: string, sig: string): boolean {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  const expected = sign(`${uid}|${exp}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
