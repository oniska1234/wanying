import OSS from "ali-oss";

let client: OSS | null = null;
let publicClient: OSS | null = null;

function clientOptions(internal: boolean) {
  return {
    region: process.env.OSS_REGION || "oss-cn-shenzhen",
    internal,
    secure: true,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
    bucket: process.env.OSS_BUCKET || "transfer-pic",
  };
}

export function getOSSClient(): OSS {
  if (!client) {
    client = new OSS(clientOptions(true));
  }
  return client;
}

function getPublicOSSClient(): OSS {
  if (!publicClient) {
    publicClient = new OSS(clientOptions(false));
  }
  return publicClient;
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
  // Browser-facing links must use the public endpoint. Only server-side data
  // transfer uses the Shenzhen intranet endpoint.
  const oss = getPublicOSSClient();
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
