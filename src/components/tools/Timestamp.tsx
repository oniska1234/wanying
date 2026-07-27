"use client";

import { useEffect, useState } from "react";
import { CopyButton, Label, Panel, Btn, areaCls } from "@/components/ui";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// format as Beijing time (UTC+8)
function formatBJ(ms: number): string {
  const d = new Date(ms);
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const bj = new Date(utc + 8 * 3600000);
  const w = ["日", "一", "二", "三", "四", "五", "六"][bj.getDay()];
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(
    bj.getDate()
  )} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(
    bj.getSeconds()
  )} 星期${w}`;
}

export default function Timestamp() {
  const [now, setNow] = useState(0);
  const [tsInput, setTsInput] = useState("");
  const [tsResult, setTsResult] = useState("");
  const [tsError, setTsError] = useState("");

  const [dateInput, setDateInput] = useState("");
  const [dateResult, setDateResult] = useState("");
  const [dateError, setDateError] = useState("");

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const tsToTime = () => {
    const raw = tsInput.trim();
    if (!raw) return;
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      setTsError("请输入数字时间戳");
      setTsResult("");
      return;
    }
    // auto detect seconds vs milliseconds
    const ms = raw.length <= 11 ? num * 1000 : num;
    const d = new Date(ms);
    if (isNaN(d.getTime())) {
      setTsError("无效的时间戳");
      setTsResult("");
      return;
    }
    setTsError("");
    setTsResult(
      `${formatBJ(ms)}（北京时间）\nUTC：${d.toUTCString()}\nISO：${d.toISOString()}`
    );
  };

  const timeToTs = () => {
    const raw = dateInput.trim();
    if (!raw) return;
    const d = new Date(raw);
    if (isNaN(d.getTime())) {
      setDateError("无法解析该日期，试试 2026-07-25 22:15:00");
      setDateResult("");
      return;
    }
    setDateError("");
    setDateResult(`秒：${Math.floor(d.getTime() / 1000)}\n毫秒：${d.getTime()}`);
  };

  return (
    <div className="space-y-4">
      {/* live clock */}
      <Panel className="flex flex-col gap-3 bg-ink text-paper sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs text-white/50">当前时间戳（实时）</div>
          <div className="mt-1 font-display text-3xl text-gold">
            {now ? Math.floor(now / 1000) : "—"}
          </div>
          <div className="mt-0.5 font-mono text-xs text-white/40">
            {now || "…"} ms
          </div>
        </div>
        <div className="flex gap-2">
          <CopyButton
            text={now ? String(Math.floor(now / 1000)) : ""}
            label="复制秒"
          />
          <CopyButton text={now ? String(now) : ""} label="复制毫秒" />
        </div>
      </Panel>

      {/* ts -> time */}
      <Panel>
        <Label>时间戳 → 时间</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={tsInput}
            onChange={(e) => setTsInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tsToTime()}
            placeholder="如 1753452900 或 1753452900000（自动识别）"
            className={`${areaCls} resize-none sm:flex-1`}
          />
          <Btn onClick={tsToTime} className="shrink-0">
            转换
          </Btn>
        </div>
        {tsError && <p className="mt-2 text-sm text-accent">{tsError}</p>}
        {tsResult && (
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-paper-2 p-3.5 font-mono text-sm">
            {tsResult}
          </pre>
        )}
      </Panel>

      {/* time -> ts */}
      <Panel>
        <Label>时间 → 时间戳</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && timeToTs()}
            placeholder="如 2026-07-25 22:15:00"
            className={`${areaCls} resize-none sm:flex-1`}
          />
          <div className="flex shrink-0 gap-2">
            <Btn
              variant="soft"
              onClick={() =>
                setDateInput(formatBJ(Date.now()).replace(/ 星期.$/, ""))
              }
            >
              现在
            </Btn>
            <Btn onClick={timeToTs}>转换</Btn>
          </div>
        </div>
        {dateError && <p className="mt-2 text-sm text-accent">{dateError}</p>}
        {dateResult && (
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-paper-2 p-3.5 font-mono text-sm">
            {dateResult}
          </pre>
        )}
      </Panel>
    </div>
  );
}
