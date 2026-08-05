import OSS from "ali-oss";

let client: OSS | null = null;

export function getOSSClient(): OSS {
  if (!client) {
    client = new OSS({
      region: process.env.OSS_REGION || "oss-cn-shenzhen",
      secure: true,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
      bucket: process.env.OSS_BUCKET || "transfer-pic",
    });
  }
  return client;
}

export function inputPrefix(userId: string, taskId: string): string {
  return `image-translate/${userId}/${taskId}/input/`;
}

export function outputPrefix(userId: string, taskId: string): string {
  return `image-translate/${userId}/${taskId}/output/`;
}

export async function uploadBuffer(key: string, buffer: Buffer): Promise<string> {
  const oss = getOSSClient();
  await oss.put(key, buffer);
  return key;
}

export function signedUrl(key: string, expires = 3600): string {
  const oss = getOSSClient();
  return oss.signatureUrl(key, { expires });
}

export async function listObjects(prefix: string): Promise<string[]> {
  const oss = getOSSClient();
  const result = await oss.list({ prefix, "max-keys": 200 }, {});
  return (result.objects || []).map((o) => o.name).filter((n) => !n.endsWith("/"));
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const oss = getOSSClient();
  const result = await oss.get(key);
  return result.content as Buffer;
}
