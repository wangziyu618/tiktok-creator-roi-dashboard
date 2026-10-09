# -*- coding: utf-8 -*-
"""
TikTok 纯佣达人 ROI 看板 —— 全周期数据合并脚本

将多份相互重叠的 TikTok Affiliate 达人导出（滑动窗口口径）合并为
「2026-04-11 至今」全周期单一数据集，供 build_data.py 打包。

用法：
    python scripts/merge_all.py \
        [--src "C:/Users/87090/Desktop/pifi"] \
        [--files ss.xlsx ss1.xlsx ss2.xlsx ss3.xlsx ss4.xlsx ss5.xlsx] \
        [--period-start 2026-04-11] \
        [--unit-sample-cost 5.0]

产出：
    data/merged/<PERIOD>_creator_all.csv   全周期达人明细（1 行 = 1 达人）
    data/merged/merge_log.txt              合并口径日志（冲突/退款/三口径对比）
    data/merged/meta.json                  元数据（供 build_data.py 写入 data.js）

合并口径（为什么这样做，见 merge_log.txt 与 README）：
    六份导出是相互重叠的滑动窗口（同一达人的曝光/播放/样品数会跨文件升降），
    因此【不能直接 SUM——重叠窗口会把同一事件计两次】。逐指标规则：
      * GMV / 订单 / 佣金 / 样品 / 内容 / 曝光 / 播放 等窗口值 → 取 max
        （同一达人取任一窗口的最大观测，防重复计数；GMV>0 达人在文件间近乎不相交，
          取 max ≈ 求和；仅 2 位达人跨文件 GMV 冲突，见日志）
      * 退款 → 同达人跨文件金额去重求和（不同金额 = 不同退款事件；
        相同金额跨窗口视为同一笔，防止重叠窗口重复计数）
      * CTR / CTOR / handle → 取曝光量最大那一行的平台原值（与 TikTok 后台一致）
      * ss1-ss5 缺「Products added to showcase / Customers / Products sold」总量列，
        只有 Avg.daily 均值列：
          added = (Avg.daily products added to showcase > 0)   仅作布尔用（分层/漏斗只判 >0）
          customers ≈ min(orders, items_sold)                  买家数估算
"""
import argparse
import datetime as dt
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "merged"

MONEY_COLS = [
    "Creator-attributed GMV", "Creator LIVE-attributed GMV",
    "Creator video-attributed GMV", "Refunds", "AOV",
    "Affiliate product card-attributed GMV", "Est. commission", "Est. flat fee",
]
PCT_COLS = ["CTOR", "CTR"]
AVG_ADDED_COL = "Avg.daily products added to showcase"

# 窗口值指标：取各文件最大观测（防重叠窗口重复计数）
MAX_COLS = [
    "Creator-attributed GMV", "Creator LIVE-attributed GMV",
    "Creator video-attributed GMV", "Attributed orders",
    "Creator-attributed items sold", "Items refunded",
    "Affiliate product card-attributed GMV", "LIVE streams", "Videos",
    "Total sample content", "Samples shipped", "Products added to showcase",
    "Product impressions", "Video views", "Products sold", "Customers",
    "Est. commission", "Est. flat fee",
]

CSV_COLUMN_ORDER = [
    "Creator name", "Creator-attributed GMV", "Creator LIVE-attributed GMV",
    "Creator video-attributed GMV", "Refunds", "Attributed orders",
    "Creator-attributed items sold", "Items refunded", "AOV",
    "Affiliate product card-attributed GMV", "CTOR", "LIVE streams", "Videos",
    "Total sample content", "Samples shipped", "Products added to showcase",
    "CTR", "Product impressions", "Video views", "Customers", "Products sold",
    "Est. commission", "Est. flat fee",
    "week_start", "snapshot_date", "week_id", "sample_cost", "creator_key",
    "content_count",
]


def to_money(s: pd.Series) -> pd.Series:
    return (s.astype(str).str.replace(r"[$,]", "", regex=True)
            .replace("", "0").astype(float))


def to_rate(s: pd.Series) -> pd.Series:
    return s.astype(str).str.replace("%", "").replace("", "0").astype(float) / 100


def load_one(path: Path, src_tag: str) -> pd.DataFrame:
    """读单份导出：跳过释义行 + 清洗 + 派生缺失列"""
    df = pd.read_excel(path, header=0, skiprows=[1])
    df.columns = [str(c).strip() for c in df.columns]
    for c in MONEY_COLS:
        df[c] = to_money(df[c])
    for c in PCT_COLS:
        df[c] = to_rate(df[c])

    # ---- ss1-ss5 缺总量列 -> 派生 ----
    derived = []
    if "Products added to showcase" not in df.columns:
        df["Products added to showcase"] = (df[AVG_ADDED_COL] > 0).astype(int)
        derived.append("added(布尔, 由 Avg.daily 派生)")
    if "Customers" not in df.columns:
        df["Customers"] = np.where(
            df["Attributed orders"] > 0,
            np.minimum(df["Attributed orders"],
                       df["Creator-attributed items sold"].fillna(0)),
            0)
        derived.append("customers(≈min(orders,items_sold))")
    if "Products sold" not in df.columns:
        df["Products sold"] = 0
        derived.append("products_sold(=0, 页面未使用)")

    df["creator_key"] = df["Creator name"].astype(str).str.strip().str.lower()
    df["content_count"] = df["Videos"] + df["LIVE streams"]
    df["src"] = src_tag
    print(f"  {src_tag:10s} rows={len(df):5d} creators={df['creator_key'].nunique():5d}"
          + (f"  派生: {', '.join(derived)}" if derived else ""))
    return df


def merge(files_df: list, unit_cost: float) -> tuple[pd.DataFrame, dict]:
    allrows = pd.concat(files_df, ignore_index=True)
    n_raw = len(allrows)

    # ---- 1. 窗口值指标：逐达人取 max ----
    mx = allrows.groupby("creator_key")[MAX_COLS].max()

    # ---- 2. 退款：同达人金额去重求和（不同金额=不同事件；相同金额=同一笔跨窗口重复）----
    refunds = allrows.groupby("creator_key")["Refunds"].apply(
        lambda s: float(np.unique(s.round(2)).sum()))

    # ---- 3. CTR / CTOR / handle / AOV：取曝光量最大那行的平台原值 ----
    idx = allrows.groupby("creator_key")["Product impressions"].idxmax()
    best = allrows.loc[idx].set_index("creator_key")

    merged = mx.join(best[["Creator name", "CTR", "CTOR"]])
    merged["Refunds"] = refunds
    merged["AOV"] = np.where(merged["Attributed orders"] > 0,
                             merged["Creator-attributed GMV"] / merged["Attributed orders"], 0)
    merged["sample_cost"] = merged["Samples shipped"] * unit_cost
    # 内容数 = max(Videos) + max(LIVE streams)，与窗口值指标口径一致
    merged["content_count"] = merged["Videos"] + merged["LIVE streams"]

    stats = {
        "raw_rows": n_raw,
        "union_creators": len(merged),
        "dedup_removed": n_raw - len(merged),
    }
    return merged, stats


def write_log(merged: pd.DataFrame, allrows: pd.DataFrame, files_meta: list,
              stats: dict, unit_cost: float, log_path: Path) -> str:
    lines = []
    add = lines.append
    add("TikTok 达人数据合并日志（全周期口径）")
    add(f"生成时间：{dt.datetime.now():%Y-%m-%d %H:%M}")
    add("")
    add("== 1. 输入文件 ==")
    for m in files_meta:
        add(f"  {m}")
    add(f"  原始行合计 {stats['raw_rows']} -> 去重后达人 {stats['union_creators']}"
        f"（合并 {stats['dedup_removed']} 条跨文件重复）")
    add("")
    add("== 2. 口径规则 ==")
    add("  * 六份导出为相互重叠的滑动窗口（同一达人曝光/播放/样品跨文件有升有降），")
    add("    直接 SUM 会把重叠窗口的同一事件计两次 -> 全部按达人去重。")
    add("  * 窗口值指标（GMV/订单/佣金/样品/内容/曝光/播放/铺货）取各文件最大观测。")
    add("  * 退款按达人金额去重求和：不同金额=不同退款事件；相同金额视为同一笔跨窗口重复。")
    add("  * CTR/CTOR/handle 取曝光量最大一行的平台原值；AOV = GMV/订单 重算。")
    add("  * ss1-ss5 无「铺货/买家/销量」总量列：铺货由 Avg.daily>0 布尔派生，买家数≈min(订单,件数)。")
    add("")
    add("== 3. GMV 跨文件冲突达人（取 max）==")
    pos = allrows[allrows["Creator-attributed GMV"] > 0]
    gp = pos.groupby("creator_key")["Creator-attributed GMV"].agg(["count", "min", "max"])
    for k, row in gp[gp["count"] > 1].iterrows():
        detail = pos[pos["creator_key"] == k][["src", "Creator-attributed GMV"]].values.tolist()
        add(f"  {k}: 取 max=${row['max']:.2f}（各文件值: "
            + "; ".join(f"{s}=${v:.2f}" for s, v in detail) + "）")
    add("")
    add("== 4. 退款事件（全周期净 GMV 口径）==")
    for _, r in allrows[allrows["Refunds"] > 0].sort_values("Refunds", ascending=False).iterrows():
        add(f"  {r['src']:9s} {r['Creator name']:22s} 退款 ${r['Refunds']:.2f}"
            f"（该窗口 GMV ${r['Creator-attributed GMV']:.2f} · 退件 {r['Items refunded']:.0f}）")
    add("")
    add("== 5. 三口径对比（SUM=错误口径，仅作展示）==")
    for col, label in [("Creator-attributed GMV", "GMV"), ("Est. commission", "佣金"),
                       ("Samples shipped", "样品")]:
        s = allrows[col].sum()
        m = merged[col].sum()
        add(f"  {label:4s}: SUM={s:,.2f}  union+max={m:,.2f}  去重修正={s - m:,.2f}")
    add(f"  样品成本（${unit_cost}/件）: ${merged['sample_cost'].sum():,.2f}")
    text = "\n".join(lines)
    log_path.write_text(text, encoding="utf-8")
    return text


def main() -> None:
    ap = argparse.ArgumentParser(description="合并多份 TikTok 达人导出为全周期数据集")
    ap.add_argument("--src", default=r"C:/Users/87090/Desktop/pifi")
    ap.add_argument("--files", nargs="+",
                    default=["ss.xlsx", "ss1.xlsx", "ss2.xlsx", "ss3.xlsx", "ss4.xlsx", "ss5.xlsx"])
    ap.add_argument("--period-start", default="2026-04-11")
    ap.add_argument("--unit-sample-cost", type=float, default=5.0)
    args = ap.parse_args()

    src_dir = Path(args.src)
    period = pd.Timestamp(args.period_start)
    print(f"读取 {len(args.files)} 份导出（{src_dir}）…")
    frames = []
    files_meta = []
    for fn in args.files:
        p = src_dir / fn
        if not p.exists():
            raise SystemExit(f"file not found: {p}")
        df = load_one(p, fn)
        frames.append(df)
        files_meta.append(f"{fn}: {len(df)} 行")

    merged, stats = merge(frames, args.unit_sample_cost)

    # ---- 时间维度列（与周度 CSV 同构，build_data.py 无缝读取）----
    merged["week_start"] = period.normalize()
    merged["snapshot_date"] = pd.Timestamp(dt.date.today())
    merged["week_id"] = period.strftime("%Y-%m-%d") + " 全周期"

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_csv = OUT_DIR / f'{period.strftime("%Y%m%d")}_creator_all.csv'
    out = merged.reset_index()[CSV_COLUMN_ORDER]
    out.to_csv(out_csv, index=False)

    log_text = write_log(merged, pd.concat(frames, ignore_index=True), files_meta,
                         stats, args.unit_sample_cost, OUT_DIR / "merge_log.txt")

    meta = {
        "generated": dt.date.today().isoformat(),
        "period_from": args.period_start,
        "sources": [{"file": fn, "rows": len(f)} for fn, f in zip(args.files, frames)],
        "raw_rows": stats["raw_rows"],
        "union_creators": stats["union_creators"],
        "unit_sample_cost": args.unit_sample_cost,
    }
    (OUT_DIR / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    gmv = merged["Creator-attributed GMV"].sum()
    comm = merged["Est. commission"].sum()
    refunds = merged["Refunds"].sum()
    samp_cost = merged["sample_cost"].sum()
    print(f"\nwritten : {out_csv}")
    print(f"union   : {stats['union_creators']} 达人（raw {stats['raw_rows']} 行）")
    print(f"GMV     : ${gmv:,.2f}（净 ${gmv - refunds:,.2f}，退款 ${refunds:,.2f} / {refunds / gmv:.1%}）")
    print(f"佣金/样品成本: ${comm:,.2f} / ${samp_cost:,.2f}")
    print(f"ROI     : 纯佣 {gmv / comm:.2f}x · 全成本 {gmv / (comm + samp_cost):.2f}x")
    print(f"出单达人: {int((merged['Creator-attributed GMV'] > 0).sum())} / {len(merged)}")
    print(f"log     : {OUT_DIR / 'merge_log.txt'}")


if __name__ == "__main__":
    main()
