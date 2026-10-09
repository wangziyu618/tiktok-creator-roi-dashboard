/* Node smoke test: verify compute & renderers against Python-verified ground truth. */
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

console.log('== data ==');
eq('weeks', D.weeks.length, 1);
eq('rows', D.rows.length, 1068);
eq('fields', D.fields.length, 27);

console.log('== computeAll (ALL) ==');
const m = api.computeAll(D, 'ALL');
eq('creators', m.kpi.creators, 1068);
eq('gmv', m.kpi.gmv, 375.0, 0.01);
eq('netGmv', m.kpi.netGmv, 375.0, 0.01);
eq('commission', m.kpi.commission, 34.12, 0.01);
eq('sampleCost', m.kpi.sampleCost, 1945.0, 0.01);
eq('orders', m.kpi.orders, 10);
eq('impressions', m.kpi.impressions, 127087);
eq('views', m.kpi.views, 117339);
eq('samples', m.kpi.samples, 389);
eq('content', m.kpi.content, 475);
eq('videos', m.kpi.videos, 312);
eq('lives', m.kpi.lives, 163);
eq('customers', m.kpi.customers, 9);
eq('items', m.kpi.items, 10);
eq('active', m.kpi.active, 8);
eq('roiCash', m.kpi.roiCash, 10.99, 0.01);
eq('roiFull', m.kpi.roiFull, 0.1895, 0.001);
eq('commissionRate', m.kpi.commissionRate, 0.091, 0.001);
eq('ctr', m.kpi.ctr, 0.02213, 0.0005);
eq('ctor', m.kpi.ctor, 0.003556, 0.0002);
eq('aov', m.kpi.aov, 37.5, 0.01);
eq('gpm', m.kpi.gpm, 3.196, 0.01);
eq('gmvPerSample', m.kpi.gmvPerSample, 0.964, 0.01);
eq('gmvPerContent', m.kpi.gmvPerContent, 0.789, 0.01);
eq('activationRate', m.kpi.activationRate, 8 / 1068, 1e-9);

console.log('== tiers ==');
const tc = {};
m.tiers.forEach(t => { tc[t.tier] = t.n; });
eq('S', tc.S, 0); eq('A', tc.A, 2); eq('B', tc.B, 6);
eq('C', tc.C, 263); eq('D', tc.D, 0); eq('E', tc.E, 156); eq('F', tc.F, 641);
eq('A.gmv', m.tiers.find(t => t.tier === 'A').gmv, 242.23, 0.01);
eq('B.gmv', m.tiers.find(t => t.tier === 'B').gmv, 132.76, 0.05);
eq('C.samples', m.tiers.find(t => t.tier === 'C').samples, 222);
eq('E.samples', m.tiers.find(t => t.tier === 'E').samples, 163);
eq('C+E samples share', (222 + 163) / 389, 0.99, 0.001);

console.log('== funnel ==');
eq('f0', m.funnel[0].n, 1068);
eq('f1', m.funnel[1].n, 350);
eq('f2', m.funnel[2].n, 268);
eq('f3', m.funnel[3].n, 268);
eq('f4', m.funnel[4].n, 891);
eq('f5', m.funnel[5].n, 8);

console.log('== lists ==');
eq('invest', m.lists.invest.length, 8);
eq('incubate', m.lists.incubate.length, 18);
eq('stop', m.lists.stop.length, 156);
eq('stopHard', m.lists.stopHard.length, 7);
eq('stopSamples', m.lists.stopSamples, 163);
eq('stopHardSamples', m.lists.stopHardSamples, 14);
eq('exit', m.lists.exit.length, 641);
eq('cLayerAll', m.lists.cLayerAll, 263);
eq('cLayerImp100', m.lists.cLayerImp100, 172);

console.log('== quadrant ==');
eq('ordered', m.quadrant.ordered.length, 8);
eq('stalled', m.quadrant.stalled.length, 172);
eq('medCtr', m.quadrant.medCtr, 0.0161, 1e-4);
eq('medCtor', m.quadrant.medCtor, 0.18335, 1e-4);

console.log('== scatter / top / heatmap ==');
eq('scatter', m.scatter.length, 350);
eq('top[0]', m.top[0].handle, 'jasmina__marie');
eq('top[0].gmv', m.top[0].gmv, 135.99, 0.001);
eq('heatmap A week0', m.heatmap.find(r => r.tier === 'A').values[0], 242.23, 0.01);
eq('heatmap B week0', m.heatmap.find(r => r.tier === 'B').values[0], 132.76, 0.05);

console.log('== renderers (string smoke) ==');
const r1 = api.renderKpis(m);
ok('kpis contain $375.00', r1.includes('$375.00'));
ok('kpis contain 10.99x', r1.includes('10.99x'));
ok('kpis contain 0.19x', r1.includes('0.19x'));
ok('kpis contain 389', r1.includes('389'));
const r2 = api.renderFunnel(m);
ok('funnel has 1,068', r2.includes('1,068'));
ok('funnel has 0.7%', r2.includes('0.7%'));
const r3 = api.renderTierShares(m);
ok('tier chart has 263', r3.includes('263'));
ok('tier chart has 99.0%', r3.includes('99.0%'));
const r4 = api.renderPareto(m);
ok('pareto top N label', r4.includes('Top 8'));
ok('pareto 100%', r4.includes('100.0%'));
const r5 = api.renderScatter(m);
ok('scatter has 350', r5.includes('350'));
const r6 = api.renderQuadrant(m);
ok('quadrant has 172', r6.includes('172'));
ok('quadrant has 8 位出单', r6.includes('8 位出单'));
const r7 = api.renderDonut(m);
ok('donut video 100%', r7.includes('100.0%'));
ok('donut mentions 163 场直播', r7.includes('163'));
const r8 = api.renderHeatmap(m);
ok('heatmap has $242', r8.includes('$242'));
const r9 = api.renderLists(m);
ok('lists 156', r9.includes('>156<'));
ok('lists 641', r9.includes('>641<'));
ok('lists 18', r9.includes('>18<'));
ok('lists 8', r9.includes('>8<'));
const r10 = api.renderBullets(m, { gmv: 500, roi: 8, active: 20 });
ok('bullets has 75%', r10.includes('75%'));
const r11 = api.renderHeadline(m, '全周期（1 周）');
ok('headline has 10.99x', r11.includes('10.99x'));
ok('headline has 0.19x', r11.includes('0.19x'));
const r12 = api.renderTable(m);
ok('table has jasmina', r12.includes('jasmina__marie'));
ok('table rows note', r12.includes('命中 1,068'));
const r13 = api.renderChain(m);
ok('chain has 127,087', r13.includes('127,087'));
ok('chain has 2.21%', r13.includes('2.21%'));
ok('chain has $37.50', r13.includes('$37.50'));

console.log('== index.html mount ids ==');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
['week-select', 'scope-label', 'data-updated', 'headline', 'kpi-grid',
  'chart-combo', 'chart-cost', 'chart-chain', 'chart-funnel', 'chart-tier',
  'chart-scatter', 'chart-pareto', 'chart-donut', 'chart-quadrant',
  'chart-heatmap', 'list-cards', 'bullets', 'table-area', 'usc'
].forEach(id => ok('index has #' + id, html.includes('id="' + id + '"')));

console.log('== single-week scope ==');
const mw = api.computeAll(D, D.weeks[0]);
eq('week gmv', mw.kpi.gmv, 375.0, 0.01);
eq('week prev is null', mw.prev, null);

console.log('\n' + (fail ? 'FAILED: ' + fail : 'ALL PASSED') + '  (' + pass + ' assertions, ' + fail + ' failures)');
process.exit(fail ? 1 : 0);
