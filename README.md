# TikTok Creator ROI Dashboard

> TikTok Shop 纯佣达人 ROI 运营看板 —— 数据合并 → 分层诊断 → 因子归因 → 可执行名单，端到端可复现，纯静态零依赖。
> **Creator ROI ops dashboard for TikTok Shop affiliate (commission-only): full-period merged pipeline, funnel-based tiering, factor-level ROI attribution, and actionable lists. End-to-end reproducible, dependency-free static page.**

**在线 Demo / Live demo**: https://wangziyu618.github.io/tiktok-creator-roi-dashboard/

**Tableau 落地设计说明书 / Tableau design spec**: [`docs/design-spec.html`](docs/design-spec.html)

---

## 数据口径 / Data provenance

数据覆盖 **2026-04-11 至今的全周期**（宠物垂类，纯佣模式）。原始输入为 6 份相互重叠的后台导出（`ss.xlsx` + `ss1~ss5.xlsx`，共 3,683 行），由 [`scripts/merge_all.py`](scripts/merge_all.py) 按达人去重合并为 **1,646 位达人**的单一快照。

**为什么不能直接相加**：六份导出是相互重叠的滑动窗口——同一位达人的播放量跨文件有升有降（例如 2.2M → 13.8M → 4.2M → 10.7M → 2.5K），样品数也会在后续窗口归零，直接 SUM 会把重叠窗口里的同一事件计两次。逐指标合并规则：

| 指标 | 规则 | 理由 |
|---|---|---|
| GMV / 订单 / 佣金 / 样品 / 内容 / 曝光 / 播放 / 铺货 | 按达人取各文件**最大观测** | 防重叠窗口重复计数；出单达人在文件间近乎不相交，取 max ≈ 求和 |
| 退款 | 按达人**金额去重求和** | 不同金额 = 不同退款事件；相同金额视为同一笔跨窗口重复 |
| CTR / CTOR / handle | 取**曝光量最大一行**的平台原值 | 与 TikTok 后台展示口径一致 |
| AOV | GMV ÷ 订单 重算 | 混合窗口下平台原值不可比 |

已知边界（全部记录在 [`data/merged/merge_log.txt`](data/merged/merge_log.txt)）：

- 仅 2 位达人跨文件 GMV 冲突（`tabbyandtuxedocat`、`laselect_shop`，取 max，影响 <7%）；
- `ss1~ss5` 缺「铺货 / 买家 / 销量」总量列：铺货由 `Avg.daily > 0` 布尔派生（页面所有逻辑只判 >0），买家数 ≈ min(订单, 件数)；
- 流量类指标（曝光 / 播放）取最大窗口观测，属**保守下界**口径。

## 为什么不是又一张 GMV 报表 / Why not just another GMV report

这份看板基于对全部 1,646 位达人的真实数据体检设计，不是模板套用。四个体检结论决定了它的结构：

1. **双口径 ROI，主动暴露隐性成本。** 表面 ROI = GMV ÷ 佣金 = **11.38x** 很好看，但纯佣模式的真实成本还有免费寄出的 829 件样品。样品按 $5/件计入后，**全成本 ROI 只有 0.41x**——仍未回本。看板把两条曲线放在一起，真正要管的是它们的收敛速度。
2. **30% 的 GMV 被退掉了。** 全周期 GMV $1,762.62 中退款 $530.44（**退款率 30.1%**），净 GMV 仅 $1,232.18——退款损耗是佣金的 3.4 倍，这是六份导出合并去重后才显形的结构性问题。
3. **按漏斗状态分层，而不是只按 GMV 排名。** 98.6% 的达人 GMV 为 0，按 GMV 排名整张图会空白。七层分层（S/A/B/C/D/E/F）让每一层都有人、都有明确的下一步动作——并直接暴露出 **96.6% 的样品投给了 0 产出的人**（C+E 层）。
4. **指标链可精确归因。** `GMV = Impressions × CTR × CTOR × AOV` 在聚合层面恒等成立（23 位出单达人行级反算中位误差 0.3%），因此 GMV 波动可以拆到因子级别——当前短板在 **CTOR（0.53%，每 190 次点击才 1 单）**，而不是 CTR（1.73%）。

## 看板结构 / Dashboard structure

| 模块 | 回答的问题 | 核心视图 |
|---|---|---|
| **① 核心指标概览** | 盘子好不好？钱花在哪？ | 8 张 KPI 卡 · GMV×双 ROI 组合图 · 成本结构（佣金 vs 样品） |
| **② 达人分层诊断** | 谁值得继续投入？ | 邀约→破零漏斗 · 七层×双占比 · 投入产出散点 · 帕累托 |
| **③ ROI 多维拆解** | 数字为什么变？ | GMV 乘法链 · 内容形态结构 · CTR×CTOR 四象限 · 层级×周期热力 |
| **④ 优化策略与效果追踪** | 下一步做什么？效果如何？ | 四张可执行名单（一键导出 CSV）· 可编辑目标子弹图 · 干预对照方案 |
| **⑤ 达人明细** | 具体是谁？ | 全量交叉表：排序 / 分层筛选 / 搜索 / 导出 |

交互：数据范围选择器、层级 chip 筛选、表头排序、名单 CSV 导出、目标值在线编辑。**当前为全周期单快照；追加多期快照后，对比与趋势自动点亮。**

## 快速开始 / Quick start

```bash
# 1) 合并六份导出为全周期快照（默认参数即可复现）
python scripts/merge_all.py

# 2) 打包为页面数据
python scripts/build_data.py

# 3) 打开看板（纯静态，双击 index.html 即可，或部署到任意静态托管）
open index.html

# 4) 校验计算逻辑（135 项断言）
node scripts/test_dashboard.js
```

## 数据管道 / Data pipeline

```
TikTok Shop 后台导出（多份重叠窗口 xlsx，共 3,683 行）
        │
        ▼
scripts/merge_all.py     # 按达人去重合并（union+max、退款去重求和、派生缺失列）
        │                # 产出 merge_log.txt：口径规则 / GMV 冲突 / 退款事件 全记录
        ▼
data/merged/20260411_creator_all.csv + meta.json     # 全周期事实表（1,646 达人）
        │
        ▼
scripts/build_data.py    # 打包为 assets/data.js（静态页内嵌，file:// 也可用）
        │
        ▼
index.html              # 零依赖静态看板（GitHub Pages / 本地双击均可）
```

**口径约定**：

- `sample_cost = Samples shipped × 单件成本`（默认 $5.0，货值 + 头程物流，`--unit-sample-cost` 可调）；
- 双口径 ROI：`ROI (Cash) = GMV / 佣金`，`ROI (Full Cost) = GMV / (佣金 + 样品成本)`；
- 净 GMV = GMV − 退款（退款按达人金额去重求和，见 merge_log.txt）。

## 核心字段字典 / Data dictionary

| 字段 | 说明 |
|---|---|
| `Creator-attributed GMV` | 达人归因 GMV（含 LIVE / 视频 / 橱窗），全周期去重口径 |
| `Est. commission` | 预估佣金（纯佣模式的主要现金成本） |
| `Samples shipped` / `sample_cost` | 寄样件数 / 样品成本（隐性成本大头） |
| `Refunds` | 退款（跨窗口金额去重求和） |
| `CTR` / `CTOR` | 曝光→点击 / 点击→下单（取曝光量最大行的平台原值） |
| `AOV` | 客单价（GMV ÷ 订单重算） |
| `Product impressions` / `Video views` | 商品曝光 / 视频播放（含橱窗曝光，可无内容） |
| `Videos` / `LIVE streams` / `Products added to showcase` | 内容产出 / 直播场次 / 铺货（ss1-5 为布尔派生） |
| `week_start` / `creator_key` | 管道派生列：数据周期起点（2026-04-11）与关联主键 |

## 测试 / Tests

`scripts/test_dashboard.js` 与页面共用同一套计算模块（`assets/app.js`），135 项断言覆盖：数据形状与 period 元数据、KPI 汇总（对照 Python 实算基准）、七层分层、漏斗、四张行动名单、四象限中位数、帕累托、渲染字符串冒烟，以及 index.html 挂载点完整性。

```bash
node scripts/test_dashboard.js
# -> ALL PASSED (135 assertions, 0 failures)
```

## 目录结构 / Repository layout

```
├── index.html                  # 交互式看板（零依赖静态页）
├── assets/
│   ├── data.js                 # 由 build_data.py 生成（全周期快照内嵌）
│   └── app.js                  # 计算与渲染（可在 node 中直接测试）
├── data/merged/
│   ├── 20260411_creator_all.csv   # 全周期事实表（1 行 = 1 达人）
│   ├── merge_log.txt               # 合并口径 / 冲突 / 退款事件日志
│   └── meta.json                   # 元数据（来源文件、去重统计）
├── data/weeks/                 # 旧周度模式样例（已被 merged 模式取代，保留兼容）
├── docs/design-spec.html       # Tableau 落地设计说明书（含计算字段公式）
└── scripts/
    ├── merge_all.py            # 全周期合并：多份重叠导出 → 去重快照
    ├── build_data.py           # 打包 data/merged/（优先）或 data/weeks/ → assets/data.js
    ├── prepare.py              # 旧周度清洗脚本（legacy，供周度模式参考）
    └── test_dashboard.js       # 135 项断言的冒烟测试
```

## 更新 SOP / Update SOP

1. 后台再导出一份达人列表 xlsx，放进源目录；
2. 把新文件名加入 `merge_all.py` 的 `--files` 列表并重跑（或直接改脚本默认值）；
3. `python scripts/build_data.py` → 刷新页面即可，无需改任何图表逻辑；
4. `node scripts/test_dashboard.js` 全绿再发布。

> ⚠️ 数据为真实运营数据（已按业务方确认公开）。样品单价为估算口径，落地前请按真实货值 + 运费校准。
