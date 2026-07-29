import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { uploadBuffer, inputPrefix, outputPrefix } from "@/lib/image-translate/oss";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const SERVICE_URL = process.env.IMAGE_TRANSLATE_SERVICE_URL || "http://127.0.0.1:8100";
const MAX_FILES = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB per task
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);

// Magic bytes for image validation
const MAGIC_BYTES: Array<{ ext: string[]; bytes: number[] }> = [
  { ext: [".jpg", ".jpeg"], bytes: [0xff, 0xd8, 0xff] },
  { ext: [".png"], bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: [".webp"], bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
  { ext: [".bmp"], bytes: [0x42, 0x4d] },
  { ext: [".tif", ".tiff"], bytes: [0x49, 0x49, 0x2a, 0x00] },
  { ext: [".tif", ".tiff"], bytes: [0x4d, 0x4d, 0x00, 0x2a] },
];

function isValidImageBuffer(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 8) return false;
  for (const magic of MAGIC_BYTES) {
    if (!magic.ext.includes(ext)) continue;
    const match = magic.bytes.every((b, i) => buffer[i] === b);
    if (match) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // P1-005: Handle missing/invalid multipart gracefully
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "请上传图片文件（multipart/form-data）" }, { status: 400 });
  }

  const files = formData.getAll("files") as File[];
  if (!files.length) {
    return NextResponse.json({ error: "没有上传文件" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `最多上传 ${MAX_FILES} 张图片` }, { status: 400 });
  }

  // Check total upload size
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    return NextResponse.json(
      { error: `单次上传总大小不能超过 50MB（当前 ${(totalSize / 1024 / 1024).toFixed(1)}MB）` },
      { status: 400 }
    );
  }

  // P1-002/003/006: Validate ALL files BEFORE creating task
  const validFiles: Array<{ file: File; ext: string; buffer: Buffer }> = [];
  const errors: string[] = [];

  for (const file of files) {
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      errors.push(`${file.name}: 不支持的格式`);
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name}: 超过 10MB 限制`);
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isValidImageBuffer(buffer, ext)) {
      errors.push(`${file.name}: 不是有效的图片文件`);
      continue;
    }
    validFiles.push({ file, ext, buffer });
  }

  // If no valid files, reject entire request
  if (validFiles.length === 0) {
    return NextResponse.json(
      { error: "没有有效的图片文件", details: errors },
      { status: 400 }
    );
  }

  const userId = session.user.id;

  // Create task record with correct total
  const task = await prisma.imageTranslateTask.create({
    data: {
      userId,
      status: "pending",
      totalCount: validFiles.length,
      sourceDir: "",
      outputDir: "",
    },
  });

  const srcPrefix = inputPrefix(userId, task.id);
  const outPrefix = outputPrefix(userId, task.id);

  await prisma.imageTranslateTask.update({
    where: { id: task.id },
    data: { sourceDir: srcPrefix, outputDir: outPrefix },
  });

  // P1-004: Use UUID filenames to prevent same-name overwrite
  const ossKeys: string[] = [];
  for (const { file, ext, buffer } of validFiles) {
    const uuid = randomUUID();
    const key = `${srcPrefix}${uuid}${ext}`;
    await uploadBuffer(key, buffer);
    ossKeys.push(key);
    await prisma.imageTranslateItem.create({
      data: { taskId: task.id, fileName: file.name, sourceKey: key, status: "pending" },
    });
  }

  // Submit to Python processing service - check response
  try {
    const resp = await fetch(`${SERVICE_URL}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: task.id, user_id: userId, images: ossKeys }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Processing service error: ${resp.status} ${errText}`);
    }
    await prisma.imageTranslateTask.update({
      where: { id: task.id },
      data: { status: "processing" },
    });
  } catch (e) {
    await prisma.imageTranslateTask.update({
      where: { id: task.id },
      data: { status: "failed", report: "处理服务暂时不可用，请重试" },
    });
    return NextResponse.json(
      { error: "处理服务暂时不可用，请稍后重试", task_id: task.id },
      { status: 503 }
    );
  }

  return NextResponse.json({
    task_id: task.id,
    total: validFiles.length,
    message: errors.length > 0
      ? `已提交 ${validFiles.length} 张，${errors.length} 个文件被跳过`
      : "任务已提交",
    skipped: errors.length > 0 ? errors : undefined,
  });
}
