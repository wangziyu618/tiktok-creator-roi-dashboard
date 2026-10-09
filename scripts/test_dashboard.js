/* Node smoke test: verify compute & renderers against Python-verified ground truth.
 * Data mode: merged full-period snapshot (2026-04-11 -> present, 6 overlapping exports
 * deduped by creator via scripts/merge_all.py; see data/merged/merge_log.txt). */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
eval(fs.readFileSync(path.join(ROOT, 'assets/data.js'), 'utf8')); // defines globalThis.DATA
const api = require(path.join(ROOT, 'assets/app.js'));

const D = globalThis.DATA;
let pass = 0, fail = 0;
function eq(name, actual, expected, tol) {
  const ok = tol === undefined ? actual === expected
    : Math.abs(actual - expected) <= tol;
  if (ok) { pass++; console.log('  ok  ' + name + ' = ' + actual); }
  else { fail++; console.log('  FAIL ' + name + ': got ' + actual + ', want ' + expected); }
}
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

console.log('== data (merged mode) ==');
eq('mode', D.mode, 'merged');
eq('weeks', D.weeks.length, 1);
eq('rows', D.rows.length, 1646);
eq('fields', D.fields.length, 27);
eq('period.from', D.period && D.period.from, '2026-04-11');
eq('period.sources', D.period && D.period.sources, 6);
eq('period.rawRows', D.period && D.period.rawRows, 3683);
eq('period.dedup', D.period && D.period.dedup, 2037);

console.log('== computeAll (ALL) ==');
const m = api.computeAll(D, 'ALL');
eq('creators', m.kpi.creators, 1646);
eq('gmv', m.kpi.gmv, 1762.62, 0.01);
eq('netGmv', m.kpi.netGmv, 1232.18, 0.01);
eq('refunds', m.kpi.refunds, 530.44, 0.01);
eq('commission', m.kpi.commission, 154.88, 0.01);
eq('sampleCost', m.kpi.sampleCost, 4145.0, 0.01);
eq('orders', m.kpi.orders, 32);
eq('impressions', m.kpi.impressions, 351968);
eq('clicks', m.kpi.clicks, 6091.49, 0.01);
eq('views', m.kpi.views, 145536249);
eq('samples', m.kpi.samples, 829);
eq('content', m.kpi.content, 1239);
eq('videos', m.kpi.videos, 820);
eq('lives', m.kpi.lives, 419);
eq('customers', m.kpi.customers, 31);
eq('items', m.kpi.items, 32);
eq('active', m.kpi.active, 23);
eq('gmvLive', m.kpi.gmvLive, 0, 0.01);
eq('gmvVideo', m.kpi.gmvVideo, 1611.64, 0.01);
eq('cardGmv', m.kpi.cardGmv, 150.98, 0.01);
eq('roiCash', m.kpi.roiCash, 11.3806, 0.001);
eq('roiFull', m.kpi.roiFull, 0.4099, 0.001);
eq('commissionRate', m.kpi.commissionRate, 0.087869, 0.0002);
eq('refundRate', m.kpi.refundRate, 0.300938, 0.001);
eq('activationRate', m.kpi.activationRate, 23 / 1646, 1e-6);
eq('ctr', m.kpi.ctr, 0.017307, 0.0005);
eq('ctor', m.kpi.ctor, 0.005253, 0.0002);
eq('aov', m.kpi.aov, 55.0819, 0.01);
eq('gpm', m.kpi.gpm, 0.0121, 0.001);
eq('gmvPerSample', m.kpi.gmvPerSample, 2.1262, 0.01);
eq('gmvPerContent', m.kpi.gmvPerContent, 1.4226, 0.01);

console.log('== tiers ==');
const tc = {};
m.tiers.forEach(t => { tc[t.tier] = t.n; });
eq('S', tc.S, 0); eq('A', tc.A, 9); eq('B', tc.B, 14);
eq('C', tc.C, 625); eq('D', tc.D, 6); eq('E', tc.E, 182); eq('F', tc.F, 810);
eq('A.gmv', m.tiers.find(t => t.tier === 'A').gmv, 1389.88, 0.01);
eq('B.gmv', m.tiers.find(t => t.tier === 'B').gmv, 372.74, 0.01);
eq('A.samples', m.tiers.find(t => t.tier === 'A').samples, 5);
eq('C.samples', m.tiers.find(t => t.tier === 'C').samples, 612);
eq('E.samples', m.tiers.find(t => t.tier === 'E').samples, 189);
eq('C+E samples share', (612 + 189) / 829, 0.9662, 0.001);

console.log('== funnel ==');
eq('f0 邀约达人池', m.funnel[0].n, 1646);
eq('f1 寄样送达', m.funnel[1].n, 769);
eq('f2 完成铺货', m.funnel[2].n, 651);
eq('f3 产出内容', m.funnel[3].n, 645);
eq('f4 获得曝光', m.funnel[4].n, 1389);
eq('f5 破零出单', m.funnel[5].n, 23);

console.log('== lists ==');
eq('invest', m.lists.invest.length, 23);
eq('incubate', m.lists.incubate.length, 46);
eq('stop', m.lists.stop.length, 182);
eq('stopHard', m.lists.stopHard.length, 7);
eq('stopSamples', m.lists.stopSamples, 189);
eq('stopHardSamples', m.lists.stopHardSamples, 14);
eq('exit', m.lists.exit.length, 810);
eq('cLayerAll', m.lists.cLayerAll, 625);
eq('cLayerImp100', m.lists.cLayerImp100, 435);

console.log('== quadrant ==');
eq('ordered', m.quadrant.ordered.length, 23);
eq('stalled', m.quadrant.stalled.length, 435);
eq('medCtr', m.quadrant.medCtr, 0.0135, 1e-4);
eq('medCtor', m.quadrant.medCtor, 0.0278, 1e-4);

console.log('== scatter / top / heatmap ==');
eq('scatter', m.scatter.length, 769);
eq('top[0]', m.top[0].handle, 'creatorlinkz');
eq('top[0].gmv', m.top[0].gmv, 271.98, 0.001);
eq('top[0].tier', m.top[0].tier, 'A');
eq('top[1]', m.top[1].handle, 'tabbyandtuxedocat');
eq('heatmap A period0', m.heatmap.find(r => r.tier === 'A').values[0], 1389.88, 0.01);
eq('heatmap B period0', m.heatmap.find(r => r.tier === 'B').values[0], 372.74, 0.01);

console.log('== renderers (string smoke) ==');
const r1 = api.renderKpis(m);
ok('kpis contain $1,762.62', r1.includes('$1,762.62'));
ok('kpis contain 11.38x', r1.includes('11.38x'));
ok('kpis contain 0.41x', r1.includes('0.41x'));
ok('kpis contain 829', r1.includes('829'));
ok('kpis note merged-mode', r1.includes('全周期合并口径'));
ok('kpis refund 30.1%', r1.includes('30.1%'));
const r2 = api.renderFunnel(m);
ok('funnel has 1,646', r2.includes('1,646'));
ok('funnel has 1.4%', r2.includes('1.4%'));
const r3 = api.renderTierShares(m);
ok('tier chart has 625', r3.includes('625'));
ok('tier chart has 96.6%', r3.includes('96.6%'));
const r4 = api.renderPareto(m);
ok('pareto top N label', r4.includes('Top 23'));
ok('pareto 100%', r4.includes('100.0%'));
const r5 = api.renderScatter(m);
ok('scatter has 769', r5.includes('769'));
const r6 = api.renderQuadrant(m);
ok('quadrant has 435', r6.includes('435'));
ok('quadrant has 23 位出单', r6.includes('23 位出单'));
const r7 = api.renderDonut(m);
ok('donut video 91.4%', r7.includes('91.4%'));
ok('donut card 8.6%', r7.includes('8.6%'));
ok('donut mentions 419 场直播', r7.includes('419'));
const r8 = api.renderHeatmap(m);
ok('heatmap has $1,390', r8.includes('$1,390'));
const r9 = api.renderLists(m);
ok('lists 182', r9.includes('>182<'));
ok('lists 810', r9.includes('>810<'));
ok('lists 46', r9.includes('>46<'));
ok('lists 23', r9.includes('>23<'));
const r10 = api.renderBullets(m, { gmv: 500, roi: 8, active: 20 });
ok('bullets all reached', r10.includes('✓ 达标'));
const r11 = api.renderHeadline(m, '2026-04-11 至今 · 全周期');
ok('headline has 1,762.62', r11.includes('1,762.62'));
ok('headline has 11.38x', r11.includes('11.38x'));
ok('headline has 0.41x', r11.includes('0.41x'));
ok('headline merged note', r11.includes('全周期累计'));
const r12 = api.renderTable(m);
ok('table has creatorlinkz', r12.includes('creatorlinkz'));
ok('table rows note', r12.includes('命中 1,646'));
const r13 = api.renderChain(m);
ok('chain has 351,968', r13.includes('351,968'));
ok('chain has 1.73%', r13.includes('1.73%'));
ok('chain has $55.08', r13.includes('$55.08'));
ok('chain has 23 位出单', r13.includes('23 位出单'));

console.log('== index.html mount ids ==');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
['week-select', 'scope-label', 'data-updated', 'headline', 'kpi-grid',
  'chart-combo', 'chart-cost', 'chart-chain', 'chart-funnel', 'chart-tier',
  'chart-scatter', 'chart-pareto', 'chart-donut', 'chart-quadrant',
  'chart-heatmap', 'list-cards', 'bullets', 'table-area', 'usc'
].forEach(id => ok('index has #' + id, html.includes('id="' + id + '"')));

console.log('== single-period scope ==');
const mw = api.computeAll(D, D.weeks[0]);
eq('period gmv', mw.kpi.gmv, 1762.62, 0.01);
eq('period prev is null', mw.prev, null);
eq('ALL prev is null', m.prev, null);
eq('model period propagates', m.period && m.period.from, '2026-04-11');

console.log('\n' + (fail ? 'FAILED: ' + fail : 'ALL PASSED') + '  (' + pass + ' assertions, ' + fail + ' failures)');
process.exit(fail ? 1 : 0);
