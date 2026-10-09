# TikTok Creator ROI Dashboard

> TikTok Shop 纯佣达人 ROI 运营看板 —— 数据清洗 → 分层诊断 → 因子归因 → 可执行名单，端到端可复现，纯静态零依赖。
> **Creator ROI ops dashboard for TikTok Shop affiliate (commission-only): weekly pipeline, funnel-based tiering, factor-level ROI attribution, and actionable lists. End-to-end reproducible, dependency-free static page.**

**在线 Demo / Live demo**: https://wangziyu618.github.io/tiktok-creator-roi-dashboard/

**Tableau 落地设计说明书 / Tableau design spec**: [`docs/design-spec.html`](docs/design-spec.html)

---

## 为什么不是又一张 GMV 报表 / Why not just another GMV report

这份看板是基于对 1,068 位达人真实快照的数据体检设计的，不是模板套用。三个体检结论决定了它的结构：

1. **双口径 ROI，主动暴露隐性成本。** 表面 ROI = GMV ÷ 佣金 = 10.99x 很好看，但纯佣模式的真实成本还有免费寄出的样品。把样品按 $5/件计入后，**全成本 ROI 只有 0.19x**。看板把两条曲线放在一起，真正要管的是它们的收敛速度。
2. **按漏斗状态分层，而不是只按 GMV 排名。** 99.3% 的达人 GMV 为 0，按 GMV 排名整张图会空白。七层分层（S/A/B/C/D/E/F）让每一层都有人、都有明确的下一步动作 —— 并直接暴露出 **99% 的样品投给了 0 产出的人**。
3. **指标链可精确归因。** `GMV = Impressions × CTR × CTOR × AOV` 已用 8 位出单达人逐条反算验证（平均误差 0.3%），因此 GMV 波动可以拆到因子级别，而不是拍脑袋解释。

---

## 看板结构 / Dashboard structure

| 模块 | 回答的问题 | 核心视图 |
|---|---|---|
| **① 核心指标概览** | 这周好不好？钱花在哪？ | 8 张 KPI 卡（含环比）· GMV×双 ROI 组合图 · 成本结构（佣金 vs 样品） |
| **② 达人分层诊断** | 谁值得下周继续投入？ | 邀约→破零漏斗 · 七层×双占比 · 投入产出散点 · 帕累托 |
| **③ ROI 多维拆解** | 数字为什么变？ | GMV 乘法链 · 内容形态结构 · CTR×CTOR 四象限 · 层级×周热力 |
| **④ 优化策略与效果追踪** | 下周做什么？效果如何？ | 四张可执行名单（一键导出 CSV）· 可编辑目标子弹图 · 干预对照方案 |
| **⑤ 达人明细** | 具体是谁？ | 全量交叉表：排序 / 分层筛选 / 搜索 / 导出 |

交互：周选择器（单周 / 全周期）、层级 chip 筛选、表头排序、名单 CSV 导出、目标值在线编辑。**追加周度数据后，趋势与环比自动点亮。**

## 快速开始 / Quick start

```bash
# 1) 每周一：TikTok Shop 后台按「上周一~周日」区间导出报表
# 2) 清洗 + 加列（周 ID、样品成本、creator_key）
python scripts/prepare.py raw_export.xlsx 2026-10-06 5.0

# 3) 重打包数据（自动吸收 data/weeks/ 下所有周）
python scripts/build_data.py

# 4) 打开看板（纯静态，双击 index.html 即可，或部署到任意静态托管）
open index.html

# 5) 校验计算逻辑（113 项断言）
node scripts/test_dashboard.js
```

Tableau 侧同构：把 `data/weeks/*_creator_weekly.csv` 用**通配符并集**接入，刷新即全量更新 —— 详见设计说明书第 01 节。

## 数据管道 / Data pipeline

```
TikTok Shop 后台（周区间导出）
        │
        ▼
scripts/prepare.py      # 文本金额/百分比 → 数值；补 week_start / sample_cost / creator_key
        │
        ▼
data/weeks/*_creator_weekly.csv    # 周度事实表（追加式，不回改历史）
        │
        ▼
scripts/build_data.py   # 打包为 assets/data.js（静态页内嵌，file:// 也可用）
        │
        ▼
index.html              # 零依赖静态看板（GitHub Pages / 本地双击均可）
```

**口径约定**：
- 每周按「周区间」导出而非累计快照，全周期 = 所有周相加，避免快照相减的退款跨期错配；
- `sample_cost = Samples shipped × 单件成本`（默认 $5.0，货值 + 头程物流，可在 prepare.py 调整）；
- 双口径 ROI：`ROI (Cash) = GMV / 佣金`，`ROI (Full Cost) = GMV / (佣金 + 样品成本)`。

## 核心字段字典 / Data dictionary

| 字段 | 说明 |
|---|---|
| `Creator-attributed GMV` | 达人归因 GMV（含 LIVE / 视频 / 橱窗） |
| `Est. commission` | 预估佣金（纯佣模式的主要现金成本） |
| `Samples shipped` / `sample_cost` | 寄样件数 / 样品成本（隐性成本大头） |
| `CTR` / `CTOR` | 曝光→点击 / 点击→下单 |
| `AOV` | 客单价 |
| `Product impressions` / `Video views` | 商品曝光 / 视频播放 |
| `Videos` / `LIVE streams` / `Products added to showcase` | 内容产出 / 直播场次 / 铺货 |
| `week_start` / `week_id` / `creator_key` | 管道派生列：周 ID 与关联主键 |

## 测试 / Tests

`scripts/test_dashboard.js` 与页面共用同一套计算模块（`assets/app.js`），113 项断言覆盖：
KPI 汇总、七层分层、漏斗、四张行动名单、四象限中位数、帕累托、渲染字符串冒烟，以及 index.html 挂载点完整性。

```bash
node scripts/test_dashboard.js
# -> ALL PASSED (113 assertions, 0 failures)
```

## 目录结构 / Repository layout

```
├── index.html                  # 交互式看板（零依赖静态页）
├── assets/
│   ├── data.js                 # 由 build_data.py 生成（自动包含全部周）
│   └── app.js                  # 计算与渲染（可在 node 中直接测试）
├── data/weeks/
│   └── 20261005_creator_weekly.csv   # 周度事实表样例
├── docs/design-spec.html       # Tableau 落地设计说明书（含计算字段公式）
└── scripts/
    ├── prepare.py              # 周度清洗：$/% 文本 → 数值 + 派生列
    ├── build_data.py           # 打包 data/weeks/*.csv → assets/data.js
    └── test_dashboard.js       # 113 项断言的冒烟测试
```

## 周更新 SOP / Weekly update SOP

1. 后台按周区间导出 → `python scripts/prepare.py raw.xlsx <该周周一>`；
2. （可选）更新干预台账 `D_Intervention`，用于模块四 Before/After 对照；
3. `python scripts/build_data.py` → 刷新页面即可，无需改任何图表逻辑。

> ⚠️ 数据为真实运营快照（已按业务方确认公开）。样品单价为估算口径，落地前请按真实货值 + 运费校准。
