/* 喜用神算法校验
   跑法： node verify-yongshen.mjs
*/
import { baziOf, dailyFortune, yearFortune, monthFortuneOf } from '../src/bazi.js';
import { wuxingStrength, favorableGods, applyAdvice, periodFortune } from '../src/yongshen.js';

let pass = 0;
let fail = 0;
function ok(c, name, extra) {
  if (c) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? '  —— ' + extra : ''}`);
  }
}

const cases = [
  { name: '1990-06-15 08:00 北京', b: { year: 1990, month: 6, day: 15, hour: 8, minute: 0, lon: 116.41, cal: 'solar' } },
  { name: '1984-02-04 12:00 上海', b: { year: 1984, month: 2, day: 4, hour: 12, minute: 0, lon: 121.47, cal: 'solar' } },
  { name: '2000-01-01 00:30 广州', b: { year: 2000, month: 1, day: 1, hour: 0, minute: 30, lon: 113.26, cal: 'solar' } },
  { name: '1975-12-31 23:30 乌鲁木齐', b: { year: 1975, month: 12, day: 31, hour: 23, minute: 30, lon: 87.62, cal: 'solar' } },
  { name: '2010-08-08 14:00 成都', b: { year: 2010, month: 8, day: 8, hour: 14, minute: 0, lon: 104.07, cal: 'solar' } },
  { name: '1955-03-15 06:00 哈尔滨', b: { year: 1955, month: 3, day: 15, hour: 6, minute: 0, lon: 126.53, cal: 'solar' } },
  { name: '2026-10-20 12:00 深圳', b: { year: 2026, month: 10, day: 20, hour: 12, minute: 0, lon: 114.06, cal: 'solar' } }
];

console.log('\n[五行力量守恒]');
for (const c of cases) {
  const chart = baziOf(c.b);
  if (!chart) {
    console.log(`  · ${c.name} 排盘失败，跳过`);
    continue;
  }
  const s = wuxingStrength(chart);
  const sum = Object.values(s.pct).reduce((a, b) => a + b, 0);
  ok(Math.abs(sum - 100) < 0.5, `${c.name} · 百分比合计≈100（实为 ${sum.toFixed(1)}）`);
  const allNonNeg = Object.values(s.score).every((v) => v >= 0);
  ok(allNonNeg, `${c.name} · 无负值`);
}

console.log('\n[喜用神自洽性]');
for (const c of cases) {
  const chart = baziOf(c.b);
  if (!chart) continue;
  const fg = favorableGods(chart);

  // 1. 用神不能等于忌神
  const u = new Set(fg.useful.map((x) => x.wx));
  const a = new Set(fg.avoid.map((x) => x.wx));
  const overlap = [...u].filter((x) => a.has(x));
  ok(overlap.length === 0, `${c.name} · 用神与忌神不重叠`, overlap.join(','));

  // 2. 用神必须有值
  ok(fg.useful.length >= 1, `${c.name} · 有至少一个用神`);

  // 3. 五行必须互不相同
  ok(u.size === fg.useful.length, `${c.name} · 用神无重复`);

  // 4. 强则用克泄耗、弱则用生扶
  const me = chart.dayMasterWuxing;
  const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
  const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
  const mother = Object.keys(SHENG).find((k) => SHENG[k] === me);
  const child = SHENG[me];
  const wealth = KE[me];
  const officer = Object.keys(KE).find((k) => KE[k] === me);

  if (fg.bias === 'strong' || fg.bias === 'mild-strong') {
    const good = fg.useful.every((x) => [child, wealth, officer].includes(x.wx));
    ok(good, `${c.name} · 偏强→取食伤/财/官杀`, fg.useful.map((x) => x.wx).join(','));
    const bad = fg.avoid.some((x) => x.wx === me || x.wx === mother);
    ok(bad, `${c.name} · 偏强→忌比劫/印`);
  } else if (fg.bias === 'weak' || fg.bias === 'mild-weak') {
    const good = fg.useful.every((x) => [mother, me].includes(x.wx));
    ok(good, `${c.name} · 偏弱→取印/比劫`, fg.useful.map((x) => x.wx).join(','));
  }

  // 5. 有推理说明
  ok(fg.reasoning.length >= 1, `${c.name} · 有推断依据`);

  // 6. 能生成建议
  const adv = applyAdvice(fg);
  ok(adv.length >= 3, `${c.name} · 生成了 ${adv.length} 条建议`);
}

console.log('\n[同一八字结果稳定]');
{
  const b = cases[0].b;
  const r1 = favorableGods(baziOf(b));
  const r2 = favorableGods(baziOf(b));
  ok(JSON.stringify(r1) === JSON.stringify(r2), '连续两次推算结果一致');
}

console.log('\n[三级运势：年/月/日]');
for (const c of cases) {
  const chart = baziOf(c.b);
  if (!chart) continue;
  const fg = favorableGods(chart);
  const f = dailyFortune(new Date(2026, 9, 20));
  const yf = yearFortune(f.solarYear);
  const mf = monthFortuneOf(new Date(2026, 9, 20));
  const pf = periodFortune(fg, chart.dayMaster, { yearGz: f.yearGz, monthGz: f.monthGz, dayGz: f.dayGz }, chart);

  ok(!!pf, `${c.name} · 三级运势生成成功`);
  ok(['大吉', '偏吉', '平', '小心', '偏凶'].includes(pf.year.grade), `${c.name} · 年吉凶取值合法（${pf.year.grade}）`);
  ok(['大吉', '偏吉', '平', '小心', '偏凶'].includes(pf.day.grade), `${c.name} · 日吉凶取值合法（${pf.day.grade}）`);
  /* 关键是：同一个日子，不同命主的结论必须不同 —— 这正是旧版最致命的问题 */
  ok(pf.yi.length >= 1, `${c.name} · 有「宜」`);
  ok(typeof pf.summary === 'string' && pf.summary.length > 4, `${c.name} · 有总评`);
  /* 用神那一行的日子必须判吉 */
  const useWx = fg.useful[0]?.wx;
  const sameAsUse = pf.day.ganWx === useWx;
  if (sameAsUse) {
    ok(pf.day.score > 0, `${c.name} · 日干为用神(${useWx})时判为正面（${pf.day.score}）`);
  }
}

console.log('\n[同一天不同命主结论必须不同]');
{
  const f = dailyFortune(new Date(2026, 9, 20));
  const outs = cases
    .map((c) => {
      const chart = baziOf(c.b);
      if (!chart) return null;
      const fg = favorableGods(chart);
      const pf = periodFortune(fg, chart.dayMaster, { yearGz: f.yearGz, monthGz: f.monthGz, dayGz: f.dayGz }, chart);
      return { who: c.name, day: pf.day.grade, yi: pf.yi.join('|'), ss: pf.day.shishen };
    })
    .filter(Boolean);
  const distinctGrades = new Set(outs.map((o) => o.day)).size;
  ok(distinctGrades >= 2, `不同命主在 2026-10-20 出现 ${distinctGrades} 种不同吉凶（不是抽签）`);
  const distinctYi = new Set(outs.map((o) => o.yi)).size;
  ok(distinctYi >= 2, `不同命主的「宜」有 ${distinctYi} 种不同组合`);
  outs.forEach((o) => console.log(`    · ${o.who} → ${o.day} / 十神 ${o.ss || '—'}`));
}

console.log('\n[流年表完整性]');
{
  const yf = yearFortune(2026);
  ok(yf.months.length === 12, `2026 年输出 12 个月建（实为 ${yf.months.length}）`);
  const zhis = yf.months.map((m) => m.zhi).join('');
  ok(zhis === '寅卯辰巳午未申酉戌亥子丑', `月支顺序正确：${zhis}`);
  /* 五虎遁校验：丙午年，正月应为庚寅 */
  ok(yf.months[0].gz === '庚寅', `2026 年正月为庚寅（实为 ${yf.months[0].gz}）`);
  const gzSet = new Set(yf.months.map((m) => m.gz));
  ok(gzSet.size === 12, '十二月建干支互不相同');
}

console.log('\n[输出示例]');
{
  const chart = baziOf(cases[0].b);
  const fg = favorableGods(chart);
  const f = dailyFortune(new Date(2026, 9, 20));
  const pf = periodFortune(fg, chart.dayMaster, { yearGz: f.yearGz, monthGz: f.monthGz, dayGz: f.dayGz }, chart);
  console.log(`  日主：${fg.dayMaster}（${fg.dayMasterWuxing}）  用神：${fg.useful.map((x) => x.wx).join('、')}`);
  console.log(`  流年 ${pf.year.gz}（${pf.year.grade}）· 流月 ${pf.month.gz}（${pf.month.grade}）· 流日 ${pf.day.gz}（${pf.day.grade}）`);
  console.log(`  总评：${pf.summary}`);
  console.log(`  当日十神：${pf.day.shishen || '—'} ${pf.day.scene ? '｜' + pf.day.scene.scene : ''}`);
  console.log(`  宜：${pf.yi.join('、')}`);
  console.log(`  忌：${pf.ji.join('、')}`);
  console.log('  注意：');
  pf.cautions.forEach((c2) => console.log('    · ' + c2));
}

console.log('\n[输出示例 · 喜用神]');
{
  const chart = baziOf(cases[0].b);
  const fg = favorableGods(chart);
  console.log(`  日主：${fg.dayMaster}（${fg.dayMasterWuxing}）`);
  console.log(`  五行：${Object.entries(fg.pct).map(([k, v]) => k + v + '%').join(' ')}`);
  console.log(`  判定：${fg.verdict}（扶身 ${fg.supportPct}%，得令=${fg.deLing}，得地=${fg.deDi}）`);
  console.log(`  用神：${fg.useful.map((x) => x.wx + '(' + x.role + ')').join('、')}`);
  console.log(`  喜神：${fg.favorable.map((x) => x.wx + '(' + x.role + ')').join('、') || '—'}`);
  console.log(`  忌神：${fg.avoid.map((x) => x.wx + '(' + x.role + ')').join('、')}`);
  console.log('  依据：');
  fg.reasoning.forEach((r) => console.log('    · ' + r));
  console.log('  建议：');
  applyAdvice(fg).forEach((a) => console.log(`    [${a.title}] ${a.text}`));
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
