"use client";

import { Check } from "lucide-react";
import { STEPS } from "@/lib/quote-types";

interface Props {
  current: number;
  onStepClick: (idx: number) => void;
}

export default function StepIndicator({ current, onStepClick }: Props) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto pb-2">
      {STEPS.map((step, idx) => {
        const done = idx < current;
        const active = idx === current;
        return (
          <button
            key={step.key}
            onClick={() => idx <= current && onStepClick(idx)}
            disabled={idx > current}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
              active
                ? "bg-[#3b5bdb] text-white shadow-[2px_2px_0_0_rgba(21,24,30,0.9)]"
                : done
                  ? "bg-[#3b5bdb]/10 text-[#3b5bdb] hover:bg-[#3b5bdb]/20"
                  : "bg-paper-2 text-ink/30 cursor-not-allowed"
            }`}
          >
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-xs ${
                active
                  ? "bg-white/20 text-white"
                  : done
                    ? "bg-[#3b5bdb] text-white"
                    : "bg-ink/10 text-ink/30"
              }`}
            >
              {done ? <Check size={13} /> : idx + 1}
            </span>
            {step.label}
          </button>
        );
      })}
    </nav>
  );
}
