import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import {
  dayInBounds,
  fmtDay,
  monthGrid,
  parseDay,
  rangeState,
  stepMonth,
} from "../../lib/assetsSelection";
import { usePopover } from "../../lib/usePopover";
import styles from "./DateRangePicker.module.css";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const MONTH_LABEL = (y: number, m1: number) => `${y} 年 ${m1} 月`;

export interface DateRangePickerProps {
  from: string; // YYYY-MM-DD 或 ""
  to: string;
  min?: string; // 注册日，可选
  max: string; // 今天
  onChange: (from: string, to: string) => void;
  onClear: () => void;
}

/**
 * #4：自定义日期区间控件（替原生 <input type=date>）。
 * 单月日历 + ‹›翻月，点选起点→终点；越界日期禁用；点完终点收起。usePopover 管外点/ESC 关闭。
 * 纯日期逻辑在 lib/assetsSelection（monthGrid/rangeState/...，已单测）。
 */
export function DateRangePicker({ from, to, min, max, onChange, onClear }: DateRangePickerProps) {
  const pop = usePopover<HTMLDivElement>();

  // 视图月份：初始化为已选终点/起点/上限所在月。
  const anchor = parseDay(to || from || max) ?? { y: 2026, m: 1, d: 1 };
  const [view, setView] = useState<{ year: number; month1: number }>({
    year: anchor.y,
    month1: anchor.m,
  });

  const openAndSync = () => {
    const a = parseDay(to || from || max);
    if (a) setView({ year: a.y, month1: a.m });
    pop.setOpen(true);
  };

  const cells = monthGrid(view.year, view.month1);

  // 翻月可达性：上一月最后一天 < min 则禁上一月；下一月第一天 > max 则禁下一月。
  const prev = stepMonth(view.year, view.month1, -1);
  const next = stepMonth(view.year, view.month1, 1);
  const prevLastDay = fmtDay(prev.year, prev.month1, new Date(prev.year, prev.month1, 0).getDate());
  const nextFirstDay = fmtDay(next.year, next.month1, 1);
  const prevDisabled = !!min && prevLastDay < min;
  const nextDisabled = nextFirstDay > max;

  const pick = (ymd: string) => {
    if (!dayInBounds(ymd, min, max)) return;
    if (!from || to) {
      onChange(ymd, ""); // 开始新区间
      return;
    }
    if (ymd < from) {
      onChange(ymd, ""); // 选的更早 → 移动起点、重置终点
      return;
    }
    onChange(from, ymd); // 设终点 → 完成、收起
    pop.setOpen(false);
  };

  const label = !from ? "选择日期区间" : to ? `${from} — ${to}` : `${from} 起`;

  return (
    <div className={styles.wrap} ref={pop.ref}>
      <button
        type="button"
        className={`${styles.trigger} ${from ? styles.triggerSet : ""}`}
        onClick={() => (pop.open ? pop.setOpen(false) : openAndSync())}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
      >
        <CalendarDays size={15} />
        <span className={styles.triggerLabel}>{label}</span>
        {from ? (
          <span
            className={styles.triggerClear}
            role="button"
            tabIndex={0}
            aria-label="清除日期"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClear();
              }
            }}
          >
            <X size={13} />
          </span>
        ) : null}
      </button>

      {pop.open ? (
        <div className={styles.popover} role="dialog" aria-label="选择日期区间">
          <div className={styles.calHead}>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => setView(prev)}
              disabled={prevDisabled}
              aria-label="上一月"
            >
              <ChevronLeft size={16} />
            </button>
            <span className={styles.monthLabel}>{MONTH_LABEL(view.year, view.month1)}</span>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => setView(next)}
              disabled={nextDisabled}
              aria-label="下一月"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className={styles.weekRow}>
            {WEEKDAYS.map((w) => (
              <span key={w} className={styles.weekCell}>
                {w}
              </span>
            ))}
          </div>

          <div className={styles.grid}>
            {cells.map((ymd, i) =>
              ymd === null ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: 固定网格补位格，无语义键
                <span key={`pad-${i}`} className={styles.pad} />
              ) : (
                <DayCell
                  key={ymd}
                  ymd={ymd}
                  state={rangeState(ymd, from, to)}
                  disabled={!dayInBounds(ymd, min, max)}
                  onPick={pick}
                />
              ),
            )}
          </div>

          <div className={styles.footer}>
            <span className={styles.footerHint}>点选起点 → 终点；仅选起点则到今天</span>
            {from || to ? (
              <button
                type="button"
                className={styles.footerClear}
                onClick={() => {
                  onClear();
                  pop.setOpen(false);
                }}
              >
                清除
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DayCell({
  ymd,
  state,
  disabled,
  onPick,
}: {
  ymd: string;
  state: "start" | "end" | "in" | "none";
  disabled: boolean;
  onPick: (ymd: string) => void;
}) {
  const day = Number(ymd.slice(8, 10));
  const cls = [
    styles.day,
    state === "start" ? styles.dayStart : "",
    state === "end" ? styles.dayEnd : "",
    state === "in" ? styles.dayIn : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} disabled={disabled} onClick={() => onPick(ymd)}>
      {day}
    </button>
  );
}
