import OSS from "ali-oss";

let client: OSS | null = null;

// Keep an extended timeout/retry budget for weak client links and transient
// OSS errors even though production storage now lives in the same region.
const OSS_REQUEST_TIMEOUT_MS = 180_000;
const OSS_RETRY_MAX = 2;

export function getOSSClient(): OSS {
  if (!client) {
    // ali-oss 6.23 supports retryMax at runtime, but its public Options type
    // does not currently declare the field. Keeping the config in a variable
    // avoids losing the supported runtime option to an unnecessary type cast.
    const options = {
      region: process.env.OSS_REGION || "oss-cn-shenzhen",
      secure: true,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
      bucket: process.env.OSS_BUCKET || "transfer-pic",
      timeout: OSS_REQUEST_TIMEOUT_MS,
      retryMax: OSS_RETRY_MAX,
    };
    client = new OSS(options);
  }
  return client;
}

export function inputPrefix(userId: string, taskId: string): string {
  return `image-translate-high-concurrency/${userId}/${taskId}/input/`;
}

export function outputPrefix(userId: string, taskId: string): string {
  return `image-translate-high-concurrency/${userId}/${taskId}/output/`;
}

export async function uploadBuffer(key: string, buffer: Buffer): Promise<string> {
  const oss = getOSSClient();
  await oss.put(key, buffer);
  return key;
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const oss = getOSSClient();
  await oss.deleteMulti(keys, { quiet: true });
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
