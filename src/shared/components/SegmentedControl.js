"use client";

import { cn } from "@/shared/utils/cn";

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
}) {
  const sizes = {
    sm: "h-7 text-xs",
    md: "h-9 text-sm",
    lg: "h-11 text-base",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center p-1 rounded-xl overflow-x-auto",
        "glass-pill shadow-inner",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "shrink-0 px-3.5 rounded-lg font-medium transition-all duration-200 cursor-pointer",
            sizes[size],
            value === option.value
              ? "bg-surface text-text-main shadow-sm border border-border/40 font-semibold dark:bg-surface-2"
              : "text-text-muted hover:text-text-main hover:bg-surface-2/40"
          )}
        >
          {option.icon && (
            <span className="material-symbols-outlined text-[16px] mr-1.5 align-middle">
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
