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

  // Sync active tasks and lazily backfill timing for completed tasks created
  // before timing fields were added.
  if (task.status === "processing" || task.status === "pending" || task.durationMs === null) {
    let serviceResponded = false;
    try {
      const resp = await fetch(`${SERVICE_URL}/task/${id}`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        serviceResponded = true;
        const data = await resp.json();
        const newStatus = data.status === "done" ? "done" : data.status === "failed" ? "failed" : "processing";
        const durationMs = Number.isFinite(data.duration_ms) ? Math.max(0, Math.round(data.duration_ms)) : null;
        await prisma.imageTranslateHighTask.update({
          where: { id },
          data: { status: newStatus, doneCount: data.done, failedCount: data.failed, durationMs },
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
            const targetStatus = r.status === "success"
              ? r.needs_review ? "review" : "success"
              : "failed";
            const targetOutputKey = r.output_key || null;
            const targetError = r.error || r.review_message || null;
            const targetDurationMs = Number.isFinite(r.duration_ms)
              ? Math.max(0, Math.round(r.duration_ms))
              : null;
            const targetCacheHit = r.cache_hit === true;
            if (
              item &&
              (item.status !== targetStatus ||
                item.outputKey !== targetOutputKey ||
                item.error !== targetError ||
                item.durationMs !== targetDurationMs ||
                item.cacheHit !== targetCacheHit)
            ) {
              await prisma.imageTranslateHighItem.update({
                where: { id: item.id },
                data: {
                  status: targetStatus,
                  outputKey: targetOutputKey,
                  error: targetError,
                  durationMs: targetDurationMs,
                  cacheHit: targetCacheHit,
                },
              });
            }
          }
        }
        task.status = newStatus;
        task.doneCount = data.done;
        task.failedCount = data.failed;
        task.durationMs = durationMs;
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
  const reviewCount = items.filter((item) => item.status === "review").length;
  const measuredDurations = items.flatMap((item) =>
    item.durationMs === null ? [] : [item.durationMs]
  );
  const averageDurationMs = measuredDurations.length > 0
    ? Math.round(measuredDurations.reduce((sum, duration) => sum + duration, 0) / measuredDurations.length)
    : null;

  return NextResponse.json({
    id: task.id,
    status: task.status,
    total_count: task.totalCount,
    done_count: task.doneCount,
    failed_count: task.failedCount,
    review_count: reviewCount,
    duration_ms: task.durationMs,
    average_duration_ms: averageDurationMs,
    created_at: task.createdAt.toISOString(),
    items: items.map((i) => ({
      id: i.id,
      file_name: i.fileName,
      status: i.status,
      source_url: i.sourceKey ? signedUrl(i.sourceKey) : null,
      output_url: i.outputKey ? signedUrl(i.outputKey) : null,
      error: i.error,
      duration_ms: i.durationMs,
      cache_hit: i.cacheHit,
    })),
  });
}
