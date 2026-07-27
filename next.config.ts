import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist / xlsx 在服务端（抽取 API）以原生方式加载，
  // 避免 webpack/Turbopack 打包其 worker / 动态依赖导致运行异常。
  serverExternalPackages: ["pdfjs-dist", "xlsx"],
};

export default nextConfig;
