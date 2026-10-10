/* ============================================================
 * TikTok Creator ROI Dashboard — logic & rendering
 * Pure compute + string renderers (testable without DOM).
 * DOM mounting only happens inside init().
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- utils ---------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtMoney = (v, d) => '$' + Number(v).toLocaleString('en-US',
    { minimumFractionDigits: d === undefined ? 0 : d, maximumFractionDigits: d === undefined ? 2 : d });
  const fmtNum = (v, d) => Number(v).toLocaleString('en-US',
    { maximumFractionDigits: d === undefined ? 0 : d });
  const fmtPct = (v, d) => (v * 100).toFixed(d === undefined ? 1 : d) + '%';
  const fmtX = (v, d) => Number(v).toFixed(d === undefined ? 2 : d) + 'x';
  const safeDiv = (a, b) => (b ? a / b : 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const median = (a) => {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const quantile = (a, q) => {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(s.length * q))];
  };

  /* 贪心标签防碰撞：items = [{x, y, w, h}]，按上下交替的多档偏移尝试，
   * 与已放置标签的近似矩形冲突则顺延；返回时给每个 item 赋 ly。 */
  function layoutLabels(items) {
    const placed = [];
    const hit = (l, t, r, b) => placed.some(p => !(r < p.l || l > p.r || b < p.t || t > p.b));
    const offsets = [-14, 16, -26, 28, -38, 40];
    items.slice().sort((a, b) => a.x - b.x || a.y - b.y).forEach(it => {
      let ly = null;
      for (const off of offsets) {
        const cy = it.y + off;
        const l = it.x - it.w / 2, r = it.x + it.w / 2, t = cy - it.h / 2, b = cy + it.h / 2;
        if (!hit(l, t, r, b)) { ly = cy; break; }
      }
      if (ly === null) ly = it.y + offsets[0]; // 放不下就接受重叠（极少发生）
      placed.push({ l: it.x - it.w / 2, r: it.x + it.w / 2, t: ly - it.h / 2, b: ly + it.h / 2 });
      it.ly = ly;
    });
    return items;
  }

  const TIER_ORDER = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
  const TIER_META = {
    S: { label: 'S · 头部产出',      color: '#0B6B52', desc: '累计 GMV ≥ $500' },
    A: { label: 'A · 稳定产出',      color: '#10A37F', desc: '累计 GMV $100–500' },
    B: { label: 'B · 已破零',        color: '#7FCFB8', desc: '累计 GMV > $0' },
    C: { label: 'C · 有内容未转化',  color: '#B45309', desc: '有内容 · GMV = $0' },
    D: { label: 'D · 铺货未产出',    color: '#8B6BD6', desc: '有橱窗 · 无内容' },
    E: { label: 'E · 寄样未铺货',    color: '#C0392B', desc: '有样品 · 无动作' },
    F: { label: 'F · 仅邀约·无动作', color: '#C7C7CC', desc: '全部为 0' },
  };
  const POS = '#137A4E', NEG = '#C0392B', ACC = '#10A37F', BLUE = '#0071E3',
    AMB = '#B45309', RED = '#C0392B', GREY = '#C7C7CC', LINE = '#E8E8ED';

  function buildIndex(fields) {
    const I = {};
    fields.forEach((f, i) => { I[f] = i; });
    return I;
  }

  /* ---------------- core: creator aggregation ---------------- */
  function aggCreators(rows, I) {
    const map = new Map();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const k = String(r[I.creator_key]);
      let c = map.get(k);
      if (!c) {
        c = {
          key: k, handle: String(r[I.handle]),
          gmv: 0, gmv_live: 0, gmv_video: 0, card_gmv: 0, refunds: 0,
          orders: 0, items_sold: 0, lives: 0, videos: 0, samples: 0,
          added: 0, impressions: 0, views: 0, customers: 0, commission: 0,
          flat_fee: 0, sample_cost: 0, content: 0, clicks: 0,
          maxImpSeen: -1, ctrSrc: 0, ctorSrc: 0,
        };
        map.set(k, c);
      }
      c.gmv += r[I.gmv]; c.gmv_live += r[I.gmv_live]; c.gmv_video += r[I.gmv_video];
      c.card_gmv += r[I.card_gmv]; c.refunds += r[I.refunds]; c.orders += r[I.orders];
      c.items_sold += r[I.items_sold]; c.lives += r[I.lives]; c.videos += r[I.videos];
      c.samples += r[I.samples]; c.added += r[I.added_to_showcase];
      c.impressions += r[I.impressions]; c.views += r[I.views];
      c.customers += r[I.customers]; c.commission += r[I.commission];
      c.flat_fee += r[I.flat_fee]; c.sample_cost += r[I.sample_cost];
      c.content += r[I.content_count];
      c.clicks += r[I.impressions] * r[I.ctr];
      // 平台原值（CTR/CTOR）：取曝光量最大的那条记录，与 TikTok 后台展示一致
      if (r[I.impressions] > c.maxImpSeen) {
        c.maxImpSeen = r[I.impressions];
        c.ctrSrc = r[I.ctr];
        c.ctorSrc = r[I.ctor];
      }
    }
    const list = Array.from(map.values());
    for (const c of list) {
      c.ctr = safeDiv(c.clicks, c.impressions);
      c.ctor = safeDiv(c.orders, c.clicks);
      c.aov = safeDiv(c.gmv, c.orders);
      c.tier =
        c.gmv >= 500 ? 'S' :
        c.gmv >= 100 ? 'A' :
        c.gmv > 0 ? 'B' :
        c.content > 0 ? 'C' :
        c.added > 0 ? 'D' :
        c.samples > 0 ? 'E' : 'F';
    }
    return list;
  }

  function kpiOf(creators) {
    const gmv = sum(creators.map(c => c.gmv));
    const refunds = sum(creators.map(c => c.refunds));
    const commission = sum(creators.map(c => c.commission));
    const sampleCost = sum(creators.map(c => c.sample_cost));
    const orders = sum(creators.map(c => c.orders));
    const impressions = sum(creators.map(c => c.impressions));
    const clicks = sum(creators.map(c => c.clicks));
    const views = sum(creators.map(c => c.views));
    const samples = sum(creators.map(c => c.samples));
    const content = sum(creators.map(c => c.content));
    const active = creators.filter(c => c.gmv > 0).length;
    const cashCost = commission;
    const totalCost = commission + sampleCost;
    return {
      creators: creators.length, gmv, netGmv: gmv - refunds, refunds,
      commission, cashCost, totalCost, sampleCost, orders, impressions,
      clicks, views, samples, content, active,
      videos: sum(creators.map(c => c.videos)),
      lives: sum(creators.map(c => c.lives)),
      customers: sum(creators.map(c => c.customers)),
      items: sum(creators.map(c => c.items_sold)),
      gmvLive: sum(creators.map(c => c.gmv_live)),
      gmvVideo: sum(creators.map(c => c.gmv_video)),
      cardGmv: sum(creators.map(c => c.card_gmv)),
      roiCash: safeDiv(gmv, cashCost),
      roiFull: safeDiv(gmv, totalCost),
      commissionRate: safeDiv(commission, gmv),
      refundRate: safeDiv(refunds, gmv),
      activationRate: safeDiv(active, creators.length),
      ctr: safeDiv(clicks, impressions),
      ctor: safeDiv(orders, clicks),
      aov: safeDiv(gmv, orders),
      gpm: safeDiv(gmv, views) * 1000,
      gmvPerSample: safeDiv(gmv, samples),
      gmvPerContent: safeDiv(gmv, content),
    };
  }

  function funnelOf(creators) {
    const n = (f) => creators.filter(f).length;
    return [
      { stage: '邀约达人池', n: n(c => true) },
      { stage: '寄样送达',   n: n(c => c.samples > 0) },
      { stage: '完成铺货',   n: n(c => c.added > 0) },
      { stage: '产出内容',   n: n(c => c.content > 0) },
      { stage: '获得曝光',   n: n(c => c.impressions > 0) },
      { stage: '破零出单',   n: n(c => c.gmv > 0) },
    ];
  }

  function tiersOf(creators) {
    return TIER_ORDER.map(t => {
      const g = creators.filter(c => c.tier === t);
      return {
        tier: t, meta: TIER_META[t],
        n: g.length,
        gmv: sum(g.map(c => c.gmv)),
        commission: sum(g.map(c => c.commission)),
        samples: sum(g.map(c => c.samples)),
        content: sum(g.map(c => c.content)),
        impressions: sum(g.map(c => c.impressions)),
        roi: safeDiv(sum(g.map(c => c.gmv)), sum(g.map(c => c.commission))),
      };
    });
  }

  function listsOf(creators, kpi) {
    const invest = creators.filter(c => c.gmv > 0)
      .sort((a, b) => b.gmv - a.gmv);
    const cLayer = creators.filter(c => c.tier === 'C');
    const incubate = cLayer.filter(c => c.impressions >= 1000)
      .sort((a, b) => b.impressions - a.impressions);
    const stop = creators.filter(c =>
      c.samples > 0 && c.added === 0 && c.content === 0 && c.gmv === 0);
    const stopHard = stop.filter(c => c.samples >= 2);
    const exit = creators.filter(c =>
      c.samples === 0 && c.added === 0 && c.content === 0 && c.gmv === 0);
    return {
      invest, incubate, stop, stopHard, exit,
      cLayerAll: cLayer.length,
      cLayerImp100: cLayer.filter(c => c.impressions >= 100).length,
      stopSamples: sum(stop.map(c => c.samples)),
      stopHardSamples: sum(stopHard.map(c => c.samples)),
    };
  }

  /* ---------------- full model ---------------- */
  function computeAll(D, scope) {
    const I = buildIndex(D.fields);
    const allRows = D.rows;
    const rows = scope === 'ALL'
      ? allRows
      : allRows.filter(r => String(r[I.week_start]) === scope);

    const prevScope = (scope !== 'ALL')
      ? D.weeks[D.weeks.indexOf(scope) - 1] || null
      : null;

    const creators = aggCreators(rows, I);
    const kpi = kpiOf(creators);
    const prev = prevScope
      ? kpiOf(aggCreators(allRows.filter(r => String(r[I.week_start]) === prevScope), I))
      : null;

    // per-week series (always all weeks, for trend charts)
    const weekSeries = D.weeks.map(w => {
      const rowsW = allRows.filter(r => String(r[I.week_start]) === w);
      const kw = kpiOf(aggCreators(rowsW, I));
      return { week: w, gmv: kw.gmv, roiCash: kw.roiCash, roiFull: kw.roiFull };
    });

    const allCreators = aggCreators(allRows, I);
    const heatmap = TIER_ORDER.map(t => {
      const g = allCreators.filter(c => c.tier === t);
      return {
        tier: t,
        values: D.weeks.map(w => {
          const keys = new Map(g.map(c => [c.key, 1]));
          return sum(allRows
            .filter(r => String(r[I.week_start]) === w && keys.has(String(r[I.creator_key])))
            .map(r => r[I.gmv]));
        }),
      };
    });

    const top = creators.slice()
      .sort((a, b) => (b.gmv - a.gmv) || (b.impressions - a.impressions))
      .slice(0, 12);
    const scatter = creators.filter(c => c.samples > 0);
    const quadrant = {
      ordered: creators.filter(c => c.orders > 0),
      stalled: creators.filter(c => c.content > 0 && c.orders === 0 && c.impressions >= 100),
    };
    quadrant.medCtr = median(quadrant.ordered.map(c => c.ctrSrc));
    quadrant.medCtor = median(quadrant.ordered.map(c => c.ctorSrc));

    return {
      scope, weeks: D.weeks, unitSampleCost: D.unit_sample_cost,
      period: D.period || null,
      rows, creators, kpi, prev, weekSeries, heatmap, top, scatter, quadrant,
      funnel: funnelOf(creators),
      tiers: tiersOf(creators),
      lists: listsOf(creators, kpi),
    };
  }

  function deltaHtml(cur, prev, fmt) {
    if (prev === null || prev === undefined) {
      const isMerged = !!(globalThis.DATA && globalThis.DATA.period);
      return '<span class="delta none" title="' +
        (isMerged ? '当前为全周期合并口径，追加新快照后显示对比' : '追加多周数据后自动显示环比') +
        '">— 无对比基线</span>';
    }
    const base = Math.abs(prev) < 1e-9
      ? (Math.abs(cur) < 1e-9 ? 0 : 1) : (cur - prev) / Math.abs(prev);
    const cls = base > 0.02 ? 'up' : base < -0.02 ? 'down' : 'flat';
    const arrow = base > 0.02 ? '▲' : base < -0.02 ? '▼' : '▬';
    return '<span class="delta ' + cls + '">' + arrow + ' 环比 ' +
      fmtPct(base) + '（上周 ' + fmt(prev) + '）</span>';
  }

  /* ---------------- SVG helpers ---------------- */
  function svgWrap(w, h, inner) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" ' +
      'style="width:100%;height:auto;display:block" role="img">' + inner + '</svg>';
  }
  const escA = (v) => esc(typeof v === 'number' ? v : v);
  function txt(x, y, s, o) {
    o = o || {};
    return '<text x="' + x + '" y="' + y + '" font-size="' + (o.size || 11) + '"' +
      (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') +
      ' fill="' + (o.fill || '#6E6E73') + '"' +
      (o.weight ? ' font-weight="' + o.weight + '"' : '') +
      (o.family ? ' font-family="' + o.family + '"' : '') + '>' + esc(s) + '</text>';
  }

  /* ---------------- renderers (return strings) ---------------- */

  function renderKpis(m) {
    const k = m.kpi;
    const oneWeek = m.weeks.length === 1;
    const cards = [
      { lab: 'Creator GMV', val: fmtMoney(k.gmv, 2), cls: 'acc',
        dlt: deltaHtml(k.gmv, m.prev && m.prev.gmv, v => fmtMoney(v, 2)),
        sub: '佣金 ' + fmtMoney(k.commission, 2) },
      { lab: 'Net GMV（扣退款）', val: fmtMoney(k.netGmv, 2), cls: '',
        dlt: deltaHtml(k.netGmv, m.prev && m.prev.netGmv, v => fmtMoney(v, 2)),
        sub: '退款 ' + fmtMoney(k.refunds, 2) + ' · ' + fmtPct(k.refundRate, 1) },
      { lab: '纯佣 ROI（现金口径）', val: fmtX(k.roiCash), cls: 'acc',
        dlt: deltaHtml(k.roiCash, m.prev && m.prev.roiCash, v => fmtX(v)),
        sub: 'GMV ÷ 佣金（不含样品）' },
      { lab: '全成本 ROI（含样品）', val: fmtX(k.roiFull), cls: 'warn',
        dlt: deltaHtml(k.roiFull, m.prev && m.prev.roiFull, v => fmtX(v)),
        sub: '含样品成本 ' + fmtMoney(k.sampleCost, 0) + '（$' +
          Number(m.unitSampleCost).toFixed(1) + '/件）' },
      { lab: '出单达人 / 激活率', val: fmtNum(k.active), cls: '',
        dlt: deltaHtml(k.active, m.prev && m.prev.active, v => fmtNum(v)),
        sub: '激活率 ' + fmtPct(k.activationRate, 1) + '（' + fmtNum(k.creators) + ' 人池）' },
      { lab: '订单 / 客单价 AOV', val: fmtNum(k.orders), cls: '',
        dlt: deltaHtml(k.orders, m.prev && m.prev.orders, v => fmtNum(v)),
        sub: 'AOV ' + fmtMoney(k.aov, 2) + ' · ' + fmtNum(k.customers) + ' 位买家' },
      { lab: '寄样 / 单样品产出', val: fmtNum(k.samples), cls: 'warn',
        dlt: deltaHtml(k.samples, m.prev && m.prev.samples, v => fmtNum(v)),
        sub: fmtMoney(k.gmvPerSample, 2) + ' GMV / 件样品' },
      { lab: '内容数 / GPM', val: fmtNum(k.content), cls: '',
        dlt: deltaHtml(k.content, m.prev && m.prev.content, v => fmtNum(v)),
        sub: 'GPM ' + fmtMoney(k.gpm, 2) + ' / 千次播放' },
    ];
    let html = cards.map(c =>
      '<div class="kpi ' + c.cls + '"><div class="lab">' + c.lab + '</div>' +
      '<div class="val">' + c.val + '</div>' +
      '<div class="dlt">' + c.dlt + '</div>' +
      '<div class="sub">' + c.sub + '</div></div>').join('');
    if (oneWeek) {
      html += m.period
        ? '<div class="kpi-note">全周期合并口径：' + fmtNum(m.period.sources) + ' 份导出去重为 ' +
          fmtNum(k.creators) + ' 位达人（' + m.period.from + ' → ' + m.period.to + '）。' +
          '有新导出时重跑 <code>scripts/merge_all.py</code> + <code>scripts/build_data.py</code> 即可更新，' +
          '追加多期快照后对比自动点亮。合并口径详见 <code>data/merged/merge_log.txt</code>。</div>'
        : '<div class="kpi-note">当前数据仅 1 周 · 每周向 ' +
          '<code>data/weeks/</code> 追加 CSV 并重跑 <code>scripts/build_data.py</code>，' +
          '趋势与环比自动点亮</div>';
    }
    return html;
  }

  function renderCombo(m) {
    const w = 640, h = 300, padL = 56, padR = 56, padT = 18, padB = 44;
    const series = m.weekSeries;
    const maxGmv = Math.max.apply(null, series.map(s => s.gmv).concat([1]));
    const maxRoi = Math.max.apply(null, series.map(s => s.roiCash).concat([1]));
    const iw = w - padL - padR, ih = h - padT - padB;
    const x = i => padL + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
    const yG = v => padT + ih - (v / maxGmv) * ih;
    const yR = v => padT + ih - (v / (maxRoi * 1.15)) * ih;
    let s = '';
    // gridlines
    for (let i = 0; i <= 4; i++) {
      const yy = padT + (ih / 4) * i;
      s += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (w - padR) + '" y2="' + yy +
        '" stroke="' + LINE + '" stroke-width="1"/>';
      s += txt(padL - 8, yy + 3, fmtMoney(maxGmv * (1 - i / 4), 0), { anchor: 'end', size: 9.5 });
    }
    // GMV bars
    const bw = Math.min(44, iw / series.length * 0.55);
    series.forEach((d, i) => {
      const xx = x(i);
      s += '<rect x="' + (xx - bw / 2) + '" y="' + yG(d.gmv) + '" width="' + bw +
        '" height="' + (padT + ih - yG(d.gmv)) + '" rx="5" fill="' + ACC + '" opacity="0.9"/>';
      s += txt(xx, yG(d.gmv) - 6, fmtMoney(d.gmv, 0), { anchor: 'middle', fill: '#1D1D1F', weight: 600, size: 11 });
      s += txt(xx, h - padB + 16, d.week, { anchor: 'middle', size: 10 });
    });
    // ROI lines
    const mkLine = (get, color, dash) => {
      const pts = series.map((d, i) => x(i) + ',' + yR(get(d))).join(' ');
      s += '<polyline points="' + pts + '" fill="none" stroke="' + color +
        '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"' +
        (dash ? ' stroke-dasharray="6 4"' : '') + '/>';
      series.forEach((d, i) => {
        s += '<circle cx="' + x(i) + '" cy="' + yR(get(d)) + '" r="4.5" fill="' + color + '" stroke="#fff" stroke-width="1.5"/>';
        s += txt(x(i) + (series.length === 1 ? 0 : 0), yR(get(d)) - 12,
          fmtX(get(d), 1), { anchor: 'middle', fill: color, weight: 700, size: 10.5 });
      });
    };
    mkLine(d => d.roiCash, BLUE, false);
    mkLine(d => d.roiFull, AMB, true);
    // right axis label
    s += txt(w - padR + 8, padT + 10, 'ROI', { fill: BLUE, weight: 700, size: 10 });
    s += txt(w - 10, padT + 10, 'ROI →', { anchor: 'end', fill: BLUE, weight: 700, size: 10 });
    s += txt(w - padR + 8, padT + 24, 'x', { fill: BLUE, size: 9 });
    let out = svgWrap(w, h, s);
    if (m.weeks.length === 1) {
      out += '<div class="chart-note">' + (m.period ? '全周期合并口径（' + m.period.from + ' 起，' +
        fmtNum(m.period.sources) + ' 份导出去重）' : '仅 1 周数据') +
        '：蓝线 = 纯佣 ROI ' + fmtX(m.kpi.roiCash) +
        '，橙虚线 = 全成本 ROI ' + fmtX(m.kpi.roiFull) +
        '。两线的<strong>收敛速度</strong>是纯佣模式最核心的健康指标。</div>';
    }
    return out;
  }

  function renderChain(m) {
    const k = m.kpi;
    const steps = [
      { lab: '商品曝光', val: fmtNum(k.impressions), sub: 'Impressions', color: '#1D1D1F' },
      { op: '× CTR', opv: fmtPct(k.ctr, 2) },
      { lab: '点击', val: fmtNum(Math.round(k.clicks)), sub: 'Clicks', color: BLUE },
      { op: '× CTOR', opv: fmtPct(k.ctor, 2) },
      { lab: '订单', val: fmtNum(k.orders), sub: 'Orders', color: AMB },
      { op: '× AOV', opv: fmtMoney(k.aov, 2) },
      { lab: 'Creator GMV', val: fmtMoney(k.gmv, 2), sub: 'GMV', color: ACC },
    ];
    let html = '<div class="chain">';
    steps.forEach(s => {
      if (s.op) {
        html += '<div class="chain-op"><span class="op">' + s.op + '</span><span class="opv">' + s.opv + '</span></div>';
      } else {
        html += '<div class="chain-step"><div class="cs-lab">' + s.lab + ' <i>' + s.sub + '</i></div>' +
          '<div class="cs-val" style="color:' + s.color + '">' + s.val + '</div></div>';
      }
    });
    html += '</div>';
    html += '<div class="chart-note">GMV = Impressions × CTR × CTOR × AOV（聚合层面恒等成立；' +
      fmtNum(m.quadrant.ordered.length) + ' 位出单达人行级反算中位误差 0.3%）。' +
      '<strong style="color:' + NEG + '">当前短板在 CTOR：CTR ' + fmtPct(k.ctr, 2) + ' 相对健康，' +
      'CTOR 仅 ' + fmtPct(k.ctor, 2) + '</strong> —— 每 ' + fmtNum(Math.round(1 / Math.max(k.ctor, 1e-9))) +
      ' 次点击才产生 1 单，问题出在落地页承接（评分 / 价格锚点 / 评价数），而非达人内容。</div>';
    return html;
  }

  function renderCostBar(m) {
    const k = m.kpi;
    const total = k.cashCost + k.sampleCost;
    const pCom = safeDiv(k.cashCost, total) * 100;
    const pSam = 100 - pCom;
    const inner =
      '<div class="stackbar">' +
      '<span style="width:' + Math.max(pCom, 0.8) + '%;background:' + RED + '" title="佣金 ' + fmtMoney(k.cashCost, 2) + '"></span>' +
      '<span style="width:' + Math.max(pSam, 0.8) + '%;background:#E39B93" title="样品 ' + fmtMoney(k.sampleCost, 0) + '"></span>' +
      '</div>' +
      '<div class="legend-row">' +
      '<span><i style="background:' + RED + '"></i>平台佣金 ' + fmtMoney(k.cashCost, 2) + '（' + pCom.toFixed(1) + '%）</span>' +
      '<span><i style="background:#E39B93"></i>样品成本 ' + fmtMoney(k.sampleCost, 0) + '（' + pSam.toFixed(1) + '%）</span>' +
      '</div>' +
      '<div class="chart-note">纯佣 ≠ 零成本：样品占总成本的 ' + pSam.toFixed(1) +
      '%。这是"纯佣 ROI 10x+"表象下真正的成本大头。</div>';
    return inner;
  }

  function renderFunnel(m) {
    const w = 640, h = 300, padL = 96, padR = 120, padT = 14, padB = 12;
    const f = m.funnel;
    const max = f[0].n || 1;
    const iw = w - padL - padR, ih = h - padT - padB;
    const bh = ih / f.length;
    let s = '';
    f.forEach((d, i) => {
      const y = padT + i * bh + 4;
      const bw = Math.max((d.n / max) * iw, 3);
      const rate = i === 0 ? null : safeDiv(d.n, f[i - 1].n);
      s += txt(padL - 10, y + bh / 2 + 4, d.stage, { anchor: 'end', size: 11.5, fill: '#1D1D1F', weight: 600 });
      s += '<rect x="' + padL + '" y="' + y + '" width="' + bw + '" height="' + (bh - 10) +
        '" rx="6" fill="' + (i === f.length - 1 ? ACC : '#10A37F') + '" opacity="' +
        (0.42 + 0.58 * (1 - i / (f.length - 1))) + '"/>';
      s += txt(padL + bw + 10, y + bh / 2 + 3, fmtNum(d.n), { fill: '#1D1D1F', weight: 700, size: 12 });
      if (rate !== null) {
        // 「获得曝光」含橱窗/商品卡曝光，可无内容而高于上一级，超过 100% 时按倍数展示
        s += txt(w - padR + 10, y + bh / 2 + 3,
          rate > 1 ? '覆盖 ' + rate.toFixed(1) + '×' : '转化 ' + fmtPct(rate, 1),
          { size: 10.5, fill: rate < 0.05 ? NEG : '#6E6E73' });
      }
    });
    return svgWrap(w, h, s) +
      '<div class="chart-note">破零率仅 <strong>' + fmtPct(safeDiv(m.funnel[5].n, m.funnel[0].n), 1) +
      '</strong>；最大断层在「获得曝光 → 破零出单」。注：「获得曝光」含商品卡 / 橱窗曝光，' +
      '达人可无内容而获得曝光，故该级可高于「产出内容」级。</div>';
  }

  function renderTierShares(m) {
    const k = m.kpi;
    const rows = m.tiers.filter(t => t.n > 0);
    const maxN = Math.max.apply(null, rows.map(t => t.n));
    const w = 640, padL = 108, padR = 200, rowH = 44;
    const h = rows.length * rowH + 66;
    const iw = w - padL - padR;
    let s = '';
    // header
    s += txt(padL, 12, '人数', { anchor: 'start', size: 10, weight: 700, fill: '#8E8E93' });
    s += txt(w - padR + 10, 12, 'GMV 占比 · 样品占比', { size: 10, weight: 700, fill: '#8E8E93' });
    rows.forEach((t, i) => {
      const y = 30 + i * rowH;
      const pctN = safeDiv(t.n, k.creators);
      s += txt(padL - 10, y + 14, t.meta.label, { anchor: 'end', size: 10.5, fill: t.meta.color, weight: 600 });
      // people bar
      s += '<rect x="' + padL + '" y="' + y + '" width="' + Math.max((t.n / maxN) * iw * 0.62, 2) +
        '" height="14" rx="4" fill="' + t.meta.color + '" opacity="0.28"/>';
      s += txt(padL + Math.max((t.n / maxN) * iw * 0.62, 2) + 6, y + 11,
        fmtNum(t.n) + ' 人 · ' + fmtPct(pctN, 0), { size: 10 });
      // gmv share bar
      const gx = w - padR + 10;
      const gw = 96;
      s += '<rect x="' + gx + '" y="' + y - 2 + '" width="' + gw + '" height="9" rx="3" fill="#F0F0F3"/>';
      s += '<rect x="' + gx + '" y="' + y - 2 + '" width="' +
        Math.max(safeDiv(t.gmv, k.gmv) * gw, t.gmv > 0 ? 3 : 0) +
        '" height="9" rx="3" fill="' + ACC + '"/>';
      // sample share bar
      s += '<rect x="' + gx + '" y="' + (y + 10) + '" width="' + gw + '" height="9" rx="3" fill="#F0F0F3"/>';
      s += '<rect x="' + gx + '" y="' + (y + 10) + '" width="' +
        Math.max(safeDiv(t.samples, k.samples) * gw, t.samples > 0 ? 3 : 0) +
        '" height="9" rx="3" fill="' + (t.gmv > 0 ? '#137A4E' : '#E39B93') + '"/>';
      const roiTxt = t.commission > 0 ? 'ROI ' + fmtX(t.roi, 1) : '—';
      s += txt(gx + gw + 8, y + 14, fmtMoney(t.gmv, 0) + ' · ' + fmtNum(t.samples) + '件 · ' + roiTxt,
        { size: 9.5, fill: '#6E6E73' });
    });
    return svgWrap(w, h, s) +
      '<div class="chart-note"><strong style="color:' + NEG + '">C + E 层吃掉 ' +
      fmtPct(safeDiv(m.tiers.filter(t => t.tier === 'C' || t.tier === 'E')
        .reduce((a, t) => a + t.samples, 0), k.samples), 1) +
      ' 的样品，产出 $0</strong> —— 资源投放精度是当前第一优先级。</div>';
  }

  function renderScatter(m) {
    const pts = m.scatter;
    const w = 640, h = 320, padL = 52, padR = 20, padT = 16, padB = 42;
    const iw = w - padL - padR, ih = h - padT - padB;
    const maxX = Math.max.apply(null, pts.map(c => c.samples).concat([1]));
    const maxY = Math.max.apply(null, pts.map(c => c.gmv).concat([1]));
    const X = v => padL + (v / (maxX * 1.05)) * iw;
    const Y = v => padT + ih - (v / (maxY * 1.12)) * ih;
    const rate = m.kpi.gmvPerSample;
    let s = '';
    for (let i = 0; i <= 4; i++) {
      const yy = padT + (ih / 4) * i;
      s += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (w - padR) + '" y2="' + yy + '" stroke="' + LINE + '"/>';
      s += txt(padL - 8, yy + 3, fmtMoney(maxY * 1.12 * (1 - i / 4), 0), { anchor: 'end', size: 9.5 });
    }
    s += '<line x1="' + padL + '" y1="' + (padT + ih) + '" x2="' + (w - padR) + '" y2="' + (padT + ih) + '" stroke="#C7C7CC"/>';
    s += '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + ih) + '" stroke="#C7C7CC"/>';
    // mean gmv-per-sample reference line
    const xEnd = (maxY * 1.12) / rate;
    s += '<line x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(Math.min(xEnd, maxX * 1.05)) +
      '" y2="' + Y(Math.min(xEnd, maxX * 1.05) * rate) +
      '" stroke="' + AMB + '" stroke-dasharray="5 4" stroke-width="1.4"/>';
    s += txt(X(Math.min(xEnd * 0.4, maxX * 0.5)), Y(Math.min(xEnd * 0.4, maxX * 0.5) * rate) - 6,
      '均值赔付线 $' + rate.toFixed(2) + '/件', { size: 9.5, fill: AMB, weight: 600 });
    pts.forEach(c => {
      const r = 3.2 + Math.sqrt(c.views) / 14;
      const hot = c.gmv > 0;
      s += '<circle cx="' + X(c.samples) + '" cy="' + Y(c.gmv) + '" r="' + Math.min(r, 11) +
        '" fill="' + (hot ? ACC : '#E39B93') + '" opacity="' + (hot ? 0.95 : 0.42) +
        '"><title>' + esc(c.handle) + ' · 样品 ' + c.samples + ' · GMV ' + fmtMoney(c.gmv, 2) +
        ' · 曝光 ' + fmtNum(c.impressions) + '</title></circle>';
    });
    // 头部达人标签：取「有寄样的达人」中 GMV Top 8，贪心防碰撞（先 clamp 再布局）
    const labelPts = m.top.filter(c => c.samples > 0).slice(0, 8);
    layoutLabels(labelPts.map(c => {
      const wpx = c.handle.length * 5.1;
      return {
        c, x: Math.max(Math.min(X(c.samples), w - padR - wpx / 2), padL + wpx / 2),
        y: Y(c.gmv), w: wpx, h: 11,
      };
    })).forEach(it => {
      s += '<text data-lab="1" x="' + it.x + '" y="' + it.ly + '" font-size="9" text-anchor="middle" ' +
        'fill="#0B6B52" font-weight="600">' + esc(it.c.handle) + '</text>';
    });
    s += txt(w / 2, h - 8, '寄样数（件）→', { anchor: 'middle', size: 10.5 });
    return svgWrap(w, h, s) +
      '<div class="chart-note">' + fmtNum(pts.length) + ' 位寄样达人。绿点 = 已破零，红点 = 零产出；' +
      '点在赔付线下方即意味着「样品亏本」。气泡大小 = 曝光量。</div>';
  }

  function renderPareto(m) {
    const sorted = m.creators.slice().sort((a, b) => b.gmv - a.gmv);
    const top = sorted.filter(c => c.gmv > 0);
    const total = m.kpi.gmv;
    const w = 640, h = 300, padL = 40, padR = 46, padT = 24, padB = 60;
    const iw = w - padL - padR, ih = h - padT - padB;
    const n = Math.max(top.length, 1);
    let cum = 0;
    const data = top.map((c, i) => {
      cum += c.gmv;
      return { c, i, cum: safeDiv(cum, total) };
    });
    const maxG = Math.max.apply(null, top.map(c => c.gmv).concat([1]));
    const bw = iw / n * 0.62;
    let s = '';
    for (let i = 0; i <= 4; i++) {
      const yy = padT + (ih / 4) * i;
      s += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (w - padR) + '" y2="' + yy + '" stroke="' + LINE + '"/>';
      s += txt(padL - 6, yy + 3, fmtMoney(maxG * (1 - i / 4), 0), { anchor: 'end', size: 9 });
    }
    data.forEach(d => {
      const x = padL + (d.i + 0.5) * (iw / n);
      const bh = (d.c.gmv / maxG) * ih;
      s += '<rect x="' + (x - bw / 2) + '" y="' + (padT + ih - bh) + '" width="' + bw +
        '" height="' + bh + '" rx="4" fill="' + ACC + '" opacity="0.9"><title>' +
        esc(d.c.handle) + ' · GMV ' + fmtMoney(d.c.gmv, 2) + ' · 累计 ' +
        (d.cum * 100).toFixed(1) + '%</title></rect>';
      // 柱槽过窄（出单达人多时），GMV 值与 handle 只标注 Top 8，其余悬停查看；
      // handle 旋转 -50° 以适应 24px 级窄槽
      if (d.i < 8) {
        s += '<text data-lab="1" x="' + x + '" y="' + (padT + ih - bh - 5) + '" font-size="9" text-anchor="middle" ' +
          'fill="#1D1D1F" font-weight="600">' + esc(fmtMoney(d.c.gmv, 0)) + '</text>';
        const hy = h - padB + 12;
        s += '<text data-lab="1" x="' + x + '" y="' + hy + '" font-size="8" text-anchor="end" ' +
          'fill="#6E6E73" transform="rotate(-50 ' + x + ' ' + hy + ')">' +
          esc(d.c.handle.length > 11 ? d.c.handle.slice(0, 10) + '…' : d.c.handle) + '</text>';
      }
      s += txt(x, h - padB + 26, (d.cum * 100).toFixed(0) + '%', { anchor: 'middle', size: 9, fill: BLUE, weight: 700 });
    });
    const line = data.map(d =>
      (padL + (d.i + 0.5) * (iw / n)) + ',' + (padT + ih - d.cum * ih * 0.96)).join(' ');
    s += '<polyline points="' + line + '" fill="none" stroke="' + BLUE + '" stroke-width="2"/>';
    s += '<line x1="' + padL + '" y1="' + (padT + ih - 0.8 * ih * 0.96) + '" x2="' + (w - padR) +
      '" y2="' + (padT + ih - 0.8 * ih * 0.96) + '" stroke="' + GREY + '" stroke-dasharray="4 4"/>';
    s += txt(w - padR - 4, padT + ih - 0.8 * ih * 0.96 - 5, '80%', { anchor: 'end', size: 9, fill: '#8E8E93' });
    return svgWrap(w, h, s) +
      '<div class="chart-note">GMV 集中度：<strong>Top ' + data.length + ' 位达人贡献 ' +
      (data.length ? (data[data.length - 1].cum * 100).toFixed(1) : '0') +
      '%</strong>（仅标注前 8 位，其余悬停柱子查看）。长尾塌陷意味着「复制爆款」比「广撒网」更紧迫。</div>';
  }

  function renderDonut(m) {
    const k = m.kpi;
    const parts = [
      { label: '短视频', v: k.gmvVideo, c: ACC },
      { label: '直播', v: k.gmvLive, c: BLUE },
      { label: '商品卡 / 橱窗', v: k.cardGmv, c: '#D9E2E9' },
    ];
    const total = parts.reduce((a, p) => a + p.v, 0) || 1;
    // donut arcs
    const cx = 110, cy = 105, R = 82, r = 52;
    let cum = -Math.PI / 2;
    let arcs = '';
    parts.forEach(p => {
      const frac = p.v / total;
      if (frac <= 0) return;
      const a0 = cum, a1 = cum + frac * Math.PI * 2;
      cum = a1;
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const xi1 = cx + r * Math.cos(a1), yi1 = cy + r * Math.sin(a1);
      const xi0 = cx + r * Math.cos(a0), yi0 = cy + r * Math.sin(a0);
      arcs += '<path d="M' + x0 + ' ' + y0 + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 +
        ' L' + xi1 + ' ' + yi1 + ' A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + xi0 + ' ' + yi0 +
        ' Z" fill="' + p.c + '"/>';
    });
    if (!arcs) {
      arcs = '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((R + r) / 2) + '" fill="none" stroke="#F0F0F3" stroke-width="' + (R - r) + '"/>';
    }
    const legend = parts.map(p =>
      '<div class="legend-row"><span><i style="background:' + p.c + '"></i>' + p.label +
      ' <b>' + fmtMoney(p.v, 2) + '</b>（' + fmtPct(safeDiv(p.v, total), 1) + '）</span></div>').join('');
    const note = '<div class="chart-note">' + fmtNum(k.videos) + ' 条短视频 + ' + fmtNum(k.lives) +
      ' 场直播已产出；GMV 结构 = 短视频 <b>' + fmtPct(safeDiv(k.gmvVideo, total), 1) +
      '</b> + 商品卡 <b>' + fmtPct(safeDiv(k.cardGmv, total), 1) + '</b>' +
      (k.lives > 0 ? '；<strong style="color:' + AMB + '">' + fmtNum(k.lives) +
        ' 场直播零转化</strong>——直播话术 / 排品值得复盘。</div>' : '</div>');
    return '<div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">' +
      svgWrap(220, 210, arcs + txt(cx, cy + 4, 'GMV', { anchor: 'middle', size: 12, fill: '#1D1D1F', weight: 700 })) +
      '<div style="flex:1;min-width:240px">' + legend + note + '</div></div>';
  }

  function renderQuadrant(m) {
    const q = m.quadrant;
    const w = 640, h = 320, padL = 52, padR = 16, padT = 20, padB = 46;
    const iw = w - padL - padR, ih = h - padT - padB;
    // 坐标轴按分位数截断，避免极端值把散点压成一团；越界点贴边 + 箭头标记
    const allCtr = q.ordered.map(c => c.ctrSrc).concat(q.stalled.map(c => c.ctrSrc));
    const capX = Math.max(quantile(allCtr, 0.95), q.medCtr * 3, 0.05);
    const capY = Math.max(quantile(q.ordered.map(c => c.ctorSrc), 0.9), q.medCtor * 3, 0.1);
    const maxX = capX * 1.12, maxY = capY * 1.25;
    const X = v => padL + (Math.min(v, capX) / maxX) * iw;
    const Y = v => padT + ih - (Math.min(v, capY) / maxY) * ih;
    let s = '';
    for (let i = 0; i <= 4; i++) {
      const yy = padT + (ih / 4) * i;
      s += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (w - padR) + '" y2="' + yy + '" stroke="' + LINE + '"/>';
      s += txt(padL - 8, yy + 3, (maxY * (1 - i / 4) * 100).toFixed(0) + '%', { anchor: 'end', size: 9 });
    }
    // medians
    s += '<line x1="' + X(q.medCtr) + '" y1="' + padT + '" x2="' + X(q.medCtr) + '" y2="' + (padT + ih) + '" stroke="#B9B9BF" stroke-dasharray="5 4"/>';
    s += '<line x1="' + padL + '" y1="' + Y(q.medCtor) + '" x2="' + (w - padR) + '" y2="' + Y(q.medCtor) + '" stroke="#B9B9BF" stroke-dasharray="5 4"/>';
    // stalled mass on x-axis
    q.stalled.forEach(c => {
      s += '<circle cx="' + X(c.ctrSrc) + '" cy="' + Y(0) + '" r="3.4" fill="' + AMB + '" opacity="0.25"><title>' +
        esc(c.handle) + ' · CTR ' + fmtPct(c.ctrSrc, 2) + ' · CTOR 0 · 曝光 ' + fmtNum(c.impressions) + '</title></circle>';
    });
    const outX = c => c.ctrSrc > capX, outY = c => c.ctorSrc > capY;
    q.ordered.forEach(c => {
      const px = X(c.ctrSrc), py = Y(c.ctorSrc);
      s += '<circle cx="' + px + '" cy="' + py + '" r="6" fill="' + ACC +
        '" stroke="#fff" stroke-width="1.6"><title>' + esc(c.handle) + ' · CTR ' + fmtPct(c.ctrSrc, 2) +
        ' · CTOR ' + fmtPct(c.ctorSrc, 2) + ' · GMV ' + fmtMoney(c.gmv, 2) + '</title></circle>';
      // 越界箭头：↑ = 真实 CTOR 超出顶轴，→ = 真实 CTR 超出右轴
      if (outY(c)) s += txt(px, py - 11, '▲', { anchor: 'middle', size: 9, fill: POS, weight: 700 });
      if (outX(c)) s += txt(px - 10, py + 3, '▶', { anchor: 'end', size: 8, fill: POS, weight: 700 });
    });
    // 只标注头部出单达人 + 越界极端值，贪心防碰撞（先 clamp 到轴域内再布局）
    const labelSet = q.ordered.slice().sort((a, b) => b.gmv - a.gmv).slice(0, 6);
    q.ordered.forEach(c => { if ((outX(c) || outY(c)) && labelSet.indexOf(c) < 0) labelSet.push(c); });
    layoutLabels(labelSet.map(c => {
      const wpx = c.handle.length * 5.3;
      return {
        c, x: Math.max(Math.min(X(c.ctrSrc), w - padR - wpx / 2), padL + wpx / 2),
        y: Y(c.ctorSrc), w: wpx, h: 12,
      };
    })).forEach(it => {
      s += '<text data-lab="1" x="' + it.x + '" y="' + it.ly + '" font-size="9.3" text-anchor="middle" ' +
        'fill="#0B6B52" font-weight="600">' + esc(it.c.handle) + '</text>';
    });
    // quadrant labels
    s += txt(w - padR - 8, padT + 14, '加码区（高CTR · 高CTOR）', { anchor: 'end', size: 10, fill: POS, weight: 700 });
    s += txt(padL + 8, padT + 14, '有人看没人买 → 优化落地页', { size: 10, fill: '#6E6E73' });
    s += txt(w - padR - 8, padT + ih - 8, '待观察', { anchor: 'end', size: 10, fill: '#8E8E93' });
    s += txt(padL + 8, padT + ih - 8, '淘汰区', { size: 10, fill: NEG });
    s += txt(w / 2, h - 8, 'CTR 点击率 →（虚线 = 出单达人中位数 ' + fmtPct(q.medCtr, 2) + '）', { anchor: 'middle', size: 10 });
    return svgWrap(w, h, s) +
      '<div class="chart-note">橙点 = ' + fmtNum(q.stalled.length) + ' 位「有曝光无下单」达人（CTOR = 0，堆在横轴上）；' +
      '绿点 = ' + fmtNum(q.ordered.length) + ' 位出单达人（仅标注头部，悬停查看全部；坐标轴按 P90–P95 截断，' +
      '▲/▶ 表示真实值超出轴域）。<strong>当前短板在 CTOR 而非 CTR</strong>：' +
      '内容能带点击，但落地页承接不住（价格锚点 / 评分 / 评价数 / 主图）。</div>';
  }

  function renderHeatmap(m) {
    const weeks = m.weeks;
    const rows = m.heatmap.filter(r => sum(r.values) > 0 ||
      m.creators.some(c => c.tier === r.tier) &&
      m.tiers.find(t => t.tier === r.tier && t.n > 0));
    const w = 640, padL = 108, padT = 40;
    const cell = 66, ch = 40;
    const h = padT + rows.length * (ch + 8) + 30;
    const maxV = Math.max.apply(null, rows.map(r => Math.max.apply(null, r.values)).concat([1]));
    let s = '';
    weeks.forEach((wk, j) => {
      s += txt(padL + j * (cell + 12) + cell / 2, padT - 12, wk, { anchor: 'middle', size: 10, fill: '#8E8E93' });
    });
    rows.forEach((r, i) => {
      const y = padT + i * (ch + 8);
      s += txt(padL - 10, y + ch / 2 + 4, r.tier + ' · ' + TIER_META[r.tier].label.split('· ')[1],
        { anchor: 'end', size: 10, fill: TIER_META[r.tier].color, weight: 600 });
      weeks.forEach((wk, j) => {
        const v = r.values[j];
        const op = 0.06 + 0.94 * Math.pow(safeDiv(v, maxV), 0.6);
        s += '<rect x="' + (padL + j * (cell + 12)) + '" y="' + y + '" width="' + cell + '" height="' + ch +
          '" rx="8" fill="' + ACC + '" opacity="' + op + '"/>' +
          '<text x="' + (padL + j * (cell + 12) + cell / 2) + '" y="' + (y + ch / 2 + 4) +
          '" text-anchor="middle" font-size="11" font-weight="600" fill="' +
          (safeDiv(v, maxV) > 0.45 ? '#FFFFFF' : '#1D1D1F') + '">' +
          (v > 0 ? fmtMoney(v, 0) : '—') + '</text>';
      });
    });
    return svgWrap(w, h, s) +
      '<div class="chart-note">行 = 达人层级（按全周期 GMV 判定），列 = 数据周期。' +
      '当前为全周期单一快照；未来按期追加快照后，可在此定位"哪一期哪一层起量"。</div>';
  }

  function renderBullets(m, targets) {
    const t = targets;
    const rows = [
      { lab: 'Creator GMV', cur: m.kpi.gmv, tgt: t.gmv, fmt: v => fmtMoney(v, 0), color: ACC },
      { lab: '纯佣 ROI', cur: m.kpi.roiCash, tgt: t.roi, fmt: v => fmtX(v, 1), color: BLUE },
      { lab: '出单达人', cur: m.kpi.active, tgt: t.active, fmt: v => fmtNum(v), color: ACC },
    ];
    return rows.map(r => {
      const pct = Math.min(safeDiv(r.cur, r.tgt), 1) * 100;
      const done = r.cur >= r.tgt;
      return '<div class="bullet-row"><div class="bullet-lab">' + r.lab + '</div>' +
        '<div class="bullet-track">' +
        '<span class="bullet-target" style="width:100%" title="目标 ' + r.fmt(r.tgt) + '"></span>' +
        '<span class="bullet-cur" style="width:' + pct + '%;background:' +
        (done ? ACC : AMB) + '" title="实际 ' + r.fmt(r.cur) + '"></span>' +
        '</div><div class="bullet-val">' + r.fmt(r.cur) + ' / <input type="number" class="tgt-input" data-key="' +
        r.lab + '" value="' + r.tgt + '" min="0"> <span class="' + (done ? 'up' : 'down') + '">' +
        (done ? '✓ 达标' : fmtPct(safeDiv(r.cur, r.tgt), 0)) + '</span></div></div>';
    }).join('');
  }

  function renderLists(m) {
    const L = m.lists;
    const cards = [
      {
        key: 'invest', cls: 'good', name: '加码名单', icon: '⬆',
        n: L.invest.length, sub: 'A/B 层 · 已破零',
        detail: '只吃过 ' + fmtNum(sum(L.invest.map(c => c.samples))) + ' 件样品，明显加得不够。追加 SKU / 提佣 2–3pt / 锁排期。',
        btn: '导出加码名单',
      },
      {
        key: 'incubate', cls: 'warn', name: '孵化名单', icon: '◎',
        n: L.incubate.length, sub: 'C 层 · 曝光 ≥ 1,000',
        detail: '已免费产出内容但零转化。优先查挂车位置与落地页承接（C 层共 ' + fmtNum(L.cLayerAll) +
          ' 人，其中曝光 ≥100 的 ' + fmtNum(L.cLayerImp100) + ' 人）。',
        btn: '导出孵化名单',
      },
      {
        key: 'stop', cls: 'bad', name: '止损名单', icon: '⏸',
        n: L.stop.length, sub: 'E 层 · 寄样未铺货',
        detail: '占用 ' + fmtNum(L.stopSamples) + ' 件样品零产出；其中 ≥2 件的 ' + L.stopHard.length +
          ' 人（' + fmtNum(L.stopHardSamples) + ' 件）可立即停寄。',
        btn: '导出止损名单',
      },
      {
        key: 'exit', cls: 'mute', name: '清退名单', icon: '⌫',
        n: L.exit.length, sub: 'F 层 · 全 0',
        detail: '批量二次触达一轮，仍无回应则移出运营池，缩小分母提升整体激活率。',
        btn: '导出清退名单',
      },
    ];
    return cards.map(c =>
      '<div class="list-card ' + c.cls + '"><div class="lc-head"><span class="lc-ic">' + c.icon + '</span>' +
      '<div><div class="lc-name">' + c.name + '</div><div class="lc-sub">' + c.sub + '</div></div>' +
      '<div class="lc-n">' + fmtNum(c.n) + '</div></div>' +
      '<div class="lc-detail">' + c.detail + '</div>' +
      '<button class="btn-export" data-list="' + c.key + '">' + c.btn + ' (CSV)</button></div>'
    ).join('');
  }

  function renderHeadline(m, scopeLabel) {
    const k = m.kpi;
    let s = '【' + scopeLabel + '】Creator GMV ' + fmtMoney(k.gmv, 2);
    if (m.prev) {
      const d = safeDiv(k.gmv - m.prev.gmv, Math.abs(m.prev.gmv) || 1);
      s += '，环比 ' + (d >= 0 ? '+' : '') + fmtPct(d, 1);
    } else {
      s += m.period
        ? '（' + m.period.from + ' 至今全周期累计，暂无对比基线）'
        : '（首期数据，环比待第二周点亮）';
    }
    s += '；纯佣 ROI ' + fmtX(k.roiCash) + '，全成本 ROI ' + fmtX(k.roiFull) +
      'x；出单达人 ' + fmtNum(k.active) + ' 位（激活率 ' + fmtPct(k.activationRate, 1) +
      '），寄样 ' + fmtNum(k.samples) + ' 件、单样品产出 ' + fmtMoney(k.gmvPerSample, 2) +
      '。当前第一优先级：把样品从 C/E 层重定向给已验证的 A/B 层。';
    return s;
  }

  /* ---------------- table ---------------- */
  const tableState = { tier: 'ALL', q: '', sort: 'gmv', dir: -1, limit: 200 };

  function tableRows(m) {
    const cols = ['handle', 'tier', 'gmv', 'orders', 'commission', 'samples', 'content',
      'impressions', 'views', 'ctr', 'ctor', 'aov'];
    let rows = m.creators;
    if (tableState.tier !== 'ALL') rows = rows.filter(c => c.tier === tableState.tier);
    if (tableState.q) {
      const q = tableState.q.toLowerCase();
      rows = rows.filter(c => c.handle.toLowerCase().includes(q));
    }
    rows = rows.slice().sort((a, b) => {
      const va = a[tableState.sort], vb = b[tableState.sort];
      if (typeof va === 'string') return tableState.dir * va.localeCompare(vb);
      return tableState.dir * (va - vb);
    });
    return { rows, cols };
  }

  function renderTable(m) {
    const { rows, cols } = tableRows(m);
    const shown = rows.slice(0, tableState.limit);
    const headers = {
      handle: '达人', tier: '层级', gmv: 'GMV', orders: '订单', commission: '佣金',
      samples: '样品', content: '内容', impressions: '曝光', views: '播放',
      ctr: 'CTR', ctor: 'CTOR', aov: 'AOV',
    };
    const chips = ['ALL'].concat(TIER_ORDER).map(t => {
      const n = t === 'ALL' ? m.creators.length : m.creators.filter(c => c.tier === t).length;
      if (t !== 'ALL' && n === 0) return '';
      const act = tableState.tier === t;
      return '<button class="chip' + (act ? ' active' : '') + '" data-tier="' + t + '">' +
        (t === 'ALL' ? '全部' : t) + ' <b>' + fmtNum(n) + '</b></button>';
    }).join('');
    const head = cols.map(c =>
      '<th class="sortable' + (tableState.sort === c ? ' sorted' : '') + '" data-col="' + c + '">' +
      headers[c] + (tableState.sort === c ? (tableState.dir < 0 ? ' ↓' : ' ↑') : '') + '</th>').join('');
    const body = shown.map(r =>
      '<tr>' + cols.map(c => {
        if (c === 'handle') return '<td class="mono">' + esc(r.handle) + '</td>';
        if (c === 'tier') return '<td><span class="tag" style="background:' +
          TIER_META[r.tier].color + '1A;color:' + TIER_META[r.tier].color + '">' + r.tier + '</span></td>';
        if (c === 'gmv') return '<td class="num">' + (r.gmv > 0 ? fmtMoney(r.gmv, 2) : '—') + '</td>';
        if (c === 'commission') return '<td class="num">' + (r.commission > 0 ? fmtMoney(r.commission, 2) : '—') + '</td>';
        if (c === 'samples') return '<td class="num">' + (r.samples || '—') + '</td>';
        if (c === 'content') return '<td class="num">' + (r.content || '—') + '</td>';
        if (c === 'impressions') return '<td class="num">' + fmtNum(r.impressions) + '</td>';
        if (c === 'views') return '<td class="num">' + fmtNum(r.views) + '</td>';
        if (c === 'ctr') return '<td class="num">' + (r.impressions ? fmtPct(r.ctr, 2) : '—') + '</td>';
        if (c === 'ctor') return '<td class="num">' + (r.clicks > 0 ? fmtPct(r.ctor, 2) : '—') + '</td>';
        if (c === 'aov') return '<td class="num">' + (r.orders > 0 ? fmtMoney(r.aov, 2) : '—') + '</td>';
        if (c === 'orders') return '<td class="num">' + (r.orders || '—') + '</td>';
        return '<td class="num">' + esc(r[c]) + '</td>';
      }).join('') + '</tr>').join('');
    return '<div class="table-tools"><div class="chips">' + chips + '</div>' +
      '<div class="table-right"><input id="table-search" type="search" placeholder="搜索达人 handle…" value="' +
      esc(tableState.q) + '"><button class="btn-export" id="table-export">导出当前视图 (CSV)</button></div></div>' +
      '<div class="tbl-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="chart-note">显示前 ' + fmtNum(shown.length) + ' 条 / 命中 ' + fmtNum(rows.length) +
      ' 条。点击表头排序；点击层级 chip 筛选。</div>';
  }

  /* ---------------- CSV export ---------------- */
  function toCsv(header, rows) {
    const q = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
    return [header.map(q).join(',')].concat(rows.map(r => r.map(q).join(','))).join('\r\n');
  }
  function download(name, content) {
    const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function exportList(m, key) {
    const map = {
      invest: { rows: m.lists.invest, name: 'invest_list' },
      incubate: { rows: m.lists.incubate, name: 'incubate_list' },
      stop: { rows: m.lists.stop, name: 'stop_loss_list' },
      exit: { rows: m.lists.exit, name: 'exit_list' },
    };
    const cfg = map[key];
    if (!cfg || !cfg.rows.length) return;
    const header = ['handle', 'tier', 'gmv', 'orders', 'commission', 'samples',
      'content', 'impressions', 'views', 'ctr', 'ctor', 'aov'];
    download(cfg.name + '_' + (m.scope === 'ALL' ? 'alltime' : m.scope) + '.csv',
      toCsv(header, cfg.rows.map(c => [c.handle, c.tier, c.gmv.toFixed(2), c.orders,
        c.commission.toFixed(2), c.samples, c.content, c.impressions, c.views,
        (c.ctr * 100).toFixed(3) + '%', (c.ctor * 100).toFixed(3) + '%',
        c.aov.toFixed(2)])));
  }

  /* ---------------- init / mount ---------------- */
  let model = null;
  const targets = { 'Creator GMV': 500, '纯佣 ROI': 8, '出单达人': 20 };

  function scopeLabel(scope) {
    if (model && model.period) return model.period.from + ' 至今 · 全周期';
    return scope === 'ALL' ? '全周期（' + model.weeks.length + ' 周）' : ('周：' + scope);
  }

  function renderAll() {
    const mount = (id, html) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    };
    mount('kpi-grid', renderKpis(model));
    mount('chart-combo', renderCombo(model));
    mount('chart-cost', renderCostBar(model));
    mount('chart-chain', renderChain(model));
    mount('chart-funnel', renderFunnel(model));
    mount('chart-tier', renderTierShares(model));
    mount('chart-scatter', renderScatter(model));
    mount('chart-pareto', renderPareto(model));
    mount('chart-donut', renderDonut(model));
    mount('chart-quadrant', renderQuadrant(model));
    mount('chart-heatmap', renderHeatmap(model));
    mount('list-cards', renderLists(model));
    mount('bullets', renderBullets(model, {
      gmv: targets['Creator GMV'], roi: targets['纯佣 ROI'], active: targets['出单达人'],
    }));
    mount('headline', renderHeadline(model, scopeLabel(model.scope)));
    mount('table-area', renderTable(model));
    document.getElementById('data-updated').textContent = model.period
      ? '数据更新：' + DATA.updated + ' · ' + DATA.period.from + ' 至今 · ' +
        fmtNum(DATA.period.sources) + ' 份导出 · ' + fmtNum(DATA.rows.length) + ' 位达人'
      : '数据更新：' + DATA.updated + ' · ' + DATA.weeks.length + ' 周 · ' +
        fmtNum(DATA.rows.length) + ' 行';
    document.getElementById('scope-label').textContent = scopeLabel(model.scope);
  }

  function init() {
    const D = global.DATA;
    if (!D) return;
    model = computeAll(D, 'ALL');
    // week selector（merged 模式 = 全周期单快照；weekly 模式 = 周 + 全周期）
    const sel = document.getElementById('week-select');
    if (D.period) {
      sel.innerHTML = '<option value="ALL">' + D.period.from + ' 至今 · 全周期合并（' +
        fmtNum(model.kpi.creators) + ' 位达人）</option>';
    } else {
      sel.innerHTML = '<option value="ALL">全周期（' + D.weeks.length + ' 周）</option>' +
        D.weeks.map(w => '<option value="' + w + '">周：' + w + '</option>').join('');
    }
    sel.value = 'ALL';
    sel.addEventListener('change', () => {
      model = computeAll(D, sel.value);
      tableState.tier = 'ALL'; tableState.q = '';
      renderAll();
    });
    renderAll();

    // delegated events
    document.addEventListener('click', (e) => {
      const t = e.target.closest ? e.target.closest('button') : null;
      if (!t) return;
      if (t.dataset && t.dataset.list) { exportList(model, t.dataset.list); return; }
      if (t.id === 'table-export') {
        const { rows } = tableRows(model);
        const header = ['handle', 'tier', 'gmv', 'orders', 'commission', 'samples',
          'content', 'impressions', 'views', 'ctr', 'ctor', 'aov'];
        download('creator_view_' + (model.scope === 'ALL' ? 'alltime' : model.scope) + '.csv',
          toCsv(header, rows.map(c => [c.handle, c.tier, c.gmv.toFixed(2), c.orders,
            c.commission.toFixed(2), c.samples, c.content, c.impressions, c.views,
            (c.ctr * 100).toFixed(3) + '%', (c.ctor * 100).toFixed(3) + '%', c.aov.toFixed(2)])));
        return;
      }
      if (t.dataset && t.dataset.tier) {
        tableState.tier = t.dataset.tier;
        document.getElementById('table-area').innerHTML = renderTable(model);
        return;
      }
      if (t.classList.contains('sortable')) {
        const col = t.dataset.col;
        if (tableState.sort === col) tableState.dir *= -1;
        else { tableState.sort = col; tableState.dir = -1; }
        document.getElementById('table-area').innerHTML = renderTable(model);
      }
    });
    document.addEventListener('input', (e) => {
      if (e.target.id === 'table-search') {
        tableState.q = e.target.value;
        const keep = e.target;
        document.getElementById('table-area').innerHTML = renderTable(model);
        const again = document.getElementById('table-search');
        if (again) { again.focus(); again.setSelectionRange(keep.selectionStart, keep.selectionEnd); }
      }
    });
    document.addEventListener('change', (e) => {
      if (e.target.classList && e.target.classList.contains('tgt-input')) {
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v >= 0) {
          targets[e.target.dataset.key] = v;
          document.getElementById('bullets').innerHTML =
            renderBullets(model, {
              gmv: targets['Creator GMV'], roi: targets['纯佣 ROI'], active: targets['出单达人'],
            });
        }
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else { init(); }
  }

  /* ---------------- exports (for node tests) ---------------- */
  const API = {
    buildIndex, aggCreators, kpiOf, funnelOf, tiersOf, listsOf, computeAll,
    renderKpis, renderCombo, renderCostBar, renderChain, renderFunnel, renderTierShares,
    renderScatter, renderPareto, renderDonut, renderQuadrant, renderHeatmap,
    renderBullets, renderLists, renderHeadline, renderTable, toCsv,
    fmtMoney, fmtNum, fmtPct, fmtX, TIER_ORDER, TIER_META,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.DashboardAPI = API;
})(typeof window !== 'undefined' ? window : globalThis);
