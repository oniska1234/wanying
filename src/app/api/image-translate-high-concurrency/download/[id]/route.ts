import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getObjectBuffer } from "@/lib/image-translate-high-concurrency/oss";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;

  const task = await prisma.imageTranslateHighTask.findFirst({
    where: { id, userId: session.user.id },
    include: { items: { where: { status: "success", outputKey: { not: null } } } },
  });
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  if (task.items.length === 0) {
    return NextResponse.json({ error: "没有可下载的结果" }, { status: 400 });
  }

  // Single file - redirect to signed URL
  if (task.items.length === 1) {
    const { signedUrl } = await import("@/lib/image-translate-high-concurrency/oss");
    const url = signedUrl(task.items[0].outputKey!, 3600);
    return NextResponse.redirect(url);
  }

  // Multiple files - create ZIP using dynamic import
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  const usedNames = new Set<string>();
  for (const item of task.items) {
    try {
      const buffer = await getObjectBuffer(item.outputKey!);
      let baseName = item.fileName.replace(/\.[^.]+$/, "") + "_translated.jpg";
      // Deduplicate same-name files
      if (usedNames.has(baseName)) {
        let counter = 2;
        while (usedNames.has(baseName.replace(".jpg", `_${counter}.jpg`))) counter++;
        baseName = baseName.replace(".jpg", `_${counter}.jpg`);
      }
      usedNames.add(baseName);
      zip.file(baseName, buffer);
    } catch { /* skip failed downloads */ }
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="image-translate-high-${id.slice(0, 8)}.zip"`,
    },
  });
}
