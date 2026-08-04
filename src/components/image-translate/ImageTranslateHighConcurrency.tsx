"use client";

import ImageTranslate from "./ImageTranslate";

export default function ImageTranslateHighConcurrency() {
  return (
    <ImageTranslate
      apiBase="/api/image-translate-high-concurrency"
      outputHint="高并发任务采用持久化队列处理，译图统一输出为 800 × 800。"
    />
  );
}
