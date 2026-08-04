import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { signedUrl } from "@/lib/image-translate-high-concurrency/oss";

export const dynamic = "force-dynamic";

const SERVICE_URL = process.env.IMAGE_TRANSLATE_HIGH_SERVICE_URL || "http://127.0.0.1:8110";

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
    include: { items: true },
  });
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  // If still processing, sync from Python service
  if (task.status === "processing" || task.status === "pending") {
    let serviceResponded = false;
    try {
      const resp = await fetch(`${SERVICE_URL}/task/${id}`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        serviceResponded = true;
        const data = await resp.json();
        const newStatus = data.status === "done" ? "done" : data.status === "failed" ? "failed" : "processing";
        await prisma.imageTranslateHighTask.update({
          where: { id },
          data: { status: newStatus, doneCount: data.done, failedCount: data.failed },
        });
        // P1-401: If task failed, mark all pending items as failed too
        if (newStatus === "failed") {
          await prisma.imageTranslateHighItem.updateMany({
            where: { taskId: id, status: "pending" },
            data: { status: "failed", error: "服务重启导致任务中断，请重新上传" },
          });
        }
        // Update items from results - match by sourceKey (UUID-based)
        if (data.results?.length) {
          for (const r of data.results) {
            if (r.file === "*") continue;
            // Match item by sourceKey ending with the result filename
            const item = task.items.find((i) => i.sourceKey?.endsWith(r.file));
            const targetStatus = r.status === "success" ? "success" : "failed";
            const targetOutputKey = r.output_key || null;
            const targetError = r.error || null;
            if (
              item &&
              (item.status !== targetStatus ||
                item.outputKey !== targetOutputKey ||
                item.error !== targetError)
            ) {
              await prisma.imageTranslateHighItem.update({
                where: { id: item.id },
                data: {
                  status: targetStatus,
                  outputKey: targetOutputKey,
                  error: targetError,
                },
              });
            }
          }
        }
        task.status = newStatus;
        task.doneCount = data.done;
        task.failedCount = data.failed;
      }
    } catch { /* service unavailable, return cached state */ }
    // P1-007: If Python service returned 404 (task lost after restart), mark failed
    if (!serviceResponded && task.status === "processing") {
      try {
        const checkResp = await fetch(`${SERVICE_URL}/task/${id}`, { signal: AbortSignal.timeout(3000) });
        if (checkResp.status === 404) {
          await prisma.imageTranslateHighTask.update({
            where: { id },
            data: { status: "failed", report: "服务重启导致任务中断，请重新上传", failedCount: task.totalCount - task.doneCount },
          });
          await prisma.imageTranslateHighItem.updateMany({
            where: { taskId: id, status: "pending" },
            data: { status: "failed", error: "服务重启导致任务中断，请重新上传" },
          });
          task.status = "failed";
        }
      } catch { /* ignore */ }
    }
  }

  // Re-fetch items after potential update
  const items = await prisma.imageTranslateHighItem.findMany({ where: { taskId: id } });

  return NextResponse.json({
    id: task.id,
    status: task.status,
    total_count: task.totalCount,
    done_count: task.doneCount,
    failed_count: task.failedCount,
    created_at: task.createdAt.toISOString(),
    items: items.map((i) => ({
      id: i.id,
      file_name: i.fileName,
      status: i.status,
      source_url: i.sourceKey ? signedUrl(i.sourceKey) : null,
      output_url: i.outputKey ? signedUrl(i.outputKey) : null,
      error: i.error,
    })),
  });
}
