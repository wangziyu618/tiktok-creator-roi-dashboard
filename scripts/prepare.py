# -*- coding: utf-8 -*-
"""
TikTok 纯佣达人 ROI 看板 —— 周度数据准备脚本

用法：
    python prepare.py <原始导出.xlsx> <该周周一 YYYY-MM-DD> [单件样品成本]

示例：
    python prepare.py ss.xlsx 2026-10-06 5.0

产出：
    data/weeks/YYYYMMDD_creator_weekly.csv   （供 Tableau 通配符并集 *_creator_weekly.csv 自动吸收）

说明：
    原始导出第 1 行是英文字段名、第 2 行是字段释义，真实数据从第 3 行开始，
    因此用 header=0, skiprows=[1]。
"""

import sys
import datetime as dt
from pathlib import Path

import pandas as pd

MONEY_COLS = [
    "Creator-attributed GMV",
    "Creator LIVE-attributed GMV",
    "Creator video-attributed GMV",
    "Refunds",
    "AOV",
    "Affiliate product card-attributed GMV",
    "Est. commission",
    "Est. flat fee",
]
PCT_COLS = ["CTOR", "CTR"]

OUT_DIR = Path("data/weeks")


def to_money(s: pd.Series) -> pd.Series:
    """'$1,234.56' / '' -> float"""
    return (
        s.astype(str)
        .str.replace(r"[$,]", "", regex=True)
        .replace("", "0")
        .astype(float)
    )


def to_rate(s: pd.Series) -> pd.Series:
    """'20%' / '0.97%' -> float 0.20 / 0.0097"""
    return s.astype(str).str.replace("%", "").replace("", "0").astype(float) / 100


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)

    src = sys.argv[1]
    week_start = pd.Timestamp(sys.argv[2])
    unit_sample_cost = float(sys.argv[3]) if len(sys.argv) > 3 else 5.0

    df = pd.read_excel(src, header=0, skiprows=[1])

    # ---- 1. 清洗：文本金额 / 百分比 -> 数值 ----
    for c in MONEY_COLS:
        if c in df.columns:
            df[c] = to_money(df[c])
    for c in PCT_COLS:
        if c in df.columns:
            df[c] = to_rate(df[c])

    # ---- 2. 时间维度：没有这几列，环比 / 趋势 / 周筛选全部无从谈起 ----
    df["week_start"] = week_start.normalize()
    df["snapshot_date"] = pd.Timestamp(dt.date.today())
    df["week_id"] = week_start.strftime("%Y-W%V")

    # ---- 3. 样品成本：把"看不见的纯佣隐性成本"变成可量化分子 ----
    df["sample_cost"] = df["Samples shipped"] * unit_sample_cost

    # ---- 4. 主键：统一大小写 / 去空格，避免 Join 丢人 ----
    df["creator_key"] = df["Creator name"].astype(str).str.strip().str.lower()

    # ---- 5. 可选派生列（也可全部留给 Tableau 计算字段）----
    df["content_count"] = df["Videos"] + df["LIVE streams"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f'{week_start.strftime("%Y%m%d")}_creator_weekly.csv'
    df.to_csv(out, index=False)

    gmv = df["Creator-attributed GMV"].sum()
    comm = df["Est. commission"].sum()
    samp_cost = df["sample_cost"].sum()
    print(f"written : {out}")
    print(f"rows    : {len(df)}")
    print(f"week    : {df['week_id'].iloc[0]}  (start {week_start.date()})")
    print(f"GMV     : ${gmv:,.2f}")
    print(f"佣金 / 样品成本 : ${comm:,.2f} / ${samp_cost:,.2f}")
    if comm > 0:
        print(f"ROI 纯佣      : {gmv / comm:.2f}x")
    if comm + samp_cost > 0:
        print(f"ROI 全成本    : {gmv / (comm + samp_cost):.2f}x")
    print(f"出单达人 : {(df['Creator-attributed GMV'] > 0).sum()} / {len(df)}")


if __name__ == "__main__":
    main()
