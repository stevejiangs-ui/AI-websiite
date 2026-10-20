/* 夏令时 + 真太阳时专项校验
   ------------------------------------------------------------------
   核心式子：真太阳时（当地钟面）= UTC + 经度×4分/度 + 均时差

   1. 1986–1991 夏令时：同一「北京钟点」，UTC 早 1 小时 → 真太阳时也早 1 小时。
   2. 逐毫秒复核该式子。
   3. 同一时刻不同经度，时辰跨度。
   4. 经度极西 + 凌晨钟点 → 真太阳时退回前一天，日柱跟退。
   5. 夜子时（23:00 后）日柱归次日。 */

import { baziOf } from '../src/bazi.js';
import { equationOfTime, unixToJd } from '../src/astro.js';

let fail = 0;
const ok = (cond, msg, extra) => {
  if (!cond) fail += 1;
  console.log(`${cond ? '✓' : '✗'} ${msg}${extra ? '  ' + extra : ''}`);
};

console.log('=== 1. 夏令时（同一钟点 1990-06-15 08:00，北京 116.41）===');
const dstYears = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992];
const rows = dstYears.map((y) => {
  const r = baziOf({ year: y, month: 6, day: 15, hour: 8, minute: 0, lon: 116.41 });
  const p = r.pillars[3];
  return { y, tz: r.tzOffsetHours, dst: r.dstApplied, solarHour: r.trueSolarHour, pillar: p.gan + p.zhi, offset: r.solarOffsetMin };
});
rows.forEach((r) =>
  console.log(`  ${r.y}  tz=+${r.tz}${r.dst ? ' 夏令时' : '      '}  真太阳时=${r.solarHour.toFixed(4)}  校正=${String(r.offset).padStart(7)}分  时柱=${r.pillar}`)
);

dstYears.forEach((y) => {
  const r = rows.find((x) => x.y === y);
  const expect = y >= 1986 && y <= 1991 ? 9 : 8;
  ok(r.tz === expect, `${y} 时区 +${expect}`, `实得 +${r.tz}`);
});

/* 夏令时年份：真太阳时应比 1985 早 1 小时（年际均时差只差几秒，容差 1 分） */
const base = rows.find((r) => r.y === 1985).solarHour;
rows.filter((r) => r.dst).forEach((r) => {
  const diffMin = (r.solarHour - base) * 60;
  ok(Math.abs(diffMin + 60) < 1, `${r.y} 比 1985 早 1 小时`, `差 ${diffMin.toFixed(2)} 分`);
});
const s1992 = rows.find((r) => r.y === 1992).solarHour;
ok(Math.abs((s1992 - base) * 60) < 1, '1992 应与 1985 一致（均无夏令时）', `差 ${((s1992 - base) * 60).toFixed(2)} 分`);

/* 校验量本身：+9 年份的校正量应比 +8 年份少 60 分钟 */
const off85 = rows.find((r) => r.y === 1985).offset;
const off90 = rows.find((r) => r.y === 1990).offset;
ok(Math.abs(off85 - off90 - 60) < 1, '夏令时年份的「校正量」应少 60 分钟', `1985=${off85} 1990=${off90}`);

console.log('\n=== 2. 逐毫秒复核：真太阳时钟面 = 北京钟点 + 经度项 + 均时差 − 夏令时差 ===');
[[2000, 1, 1, 12, 0, 116.41], [1990, 6, 15, 8, 0, 87.62], [2024, 12, 21, 3, 17, 121.47], [1988, 7, 1, 0, 3, 104.07]].forEach(
  ([y, mo, d, h, mi, lon]) => {
    const t = baziOf({ year: y, month: mo, day: d, hour: h, minute: mi, lon });
    /* 手工：钟点 + 经度项 + 均时差 − (时区−8)×60，再折回 0–24 */
    const eotExact = equationOfTime(unixToJd(t.utcMs));
    const dstMin = (t.tzOffsetHours - 8) * 60;
    const raw = h * 60 + mi + ((lon - 120) * 4 + eotExact - dstMin);
    const manualHour = (((raw % 1440) + 1440) % 1440) / 60;
    const fmt = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')} 经度 ${lon} tz+${t.tzOffsetHours}`;
    ok(Math.abs(manualHour - t.trueSolarHour) < 1e-9, fmt, `手工=${manualHour.toFixed(6)} 程序=${t.trueSolarHour.toFixed(6)}`);
  }
);

console.log('\n=== 3. 同一时刻不同经度（1990-06-15 08:00 北京时）===');
const cityRows = [['北京', 116.41], ['上海', 121.47], ['成都', 104.07], ['乌鲁木齐', 87.62], ['喀什', 75.99]].map(([name, lon]) => {
  const r = baziOf({ year: 1990, month: 6, day: 15, hour: 8, minute: 0, lon });
  const p = r.pillars[3];
  console.log(`  ${name.padEnd(5, '　')} ${String(lon).padStart(7)}  真太阳时=${r.trueSolarHour.toFixed(2)}  时柱=${p.gan}${p.zhi}`);
  return { name, zhi: p.zhi, hour: r.trueSolarHour };
});
ok(new Set(cityRows.map((x) => x.zhi)).size >= 3, '五地至少跨 3 个时支', [...new Set(cityRows.map((x) => x.zhi))].join(' '));

console.log('\n=== 4. 真太阳时跨日 → 日柱跟退（喀什 2020-03-15 00:05 / 00:40）===');
const cross = baziOf({ year: 2020, month: 3, day: 15, hour: 0, minute: 5, lon: 75.99 });
console.log(`  喀什 00:05 → 真太阳时=${cross.trueSolarHour.toFixed(3)} 日位移=${cross.solarDayShift} 日柱=${cross.pillars[2].gan}${cross.pillars[2].zhi} 校正=${cross.solarOffsetMin}分`);
ok(cross.solarDayShift === -1, '应回退一天', `实得 ${cross.solarDayShift}`);
const day14 = baziOf({ year: 2020, month: 3, day: 14, hour: 12, minute: 0, lon: 75.99, useTrueSolar: false });
const gzOf = (r) => r.pillars[2].gan + r.pillars[2].zhi;
ok(gzOf(cross) === gzOf(day14), '跨日后日柱应等于 3/14 的日柱', `${gzOf(cross)} vs ${gzOf(day14)}`);
const sameDay = baziOf({ year: 2020, month: 3, day: 15, hour: 12, minute: 0, lon: 75.99, useTrueSolar: false });
ok(gzOf(cross) !== gzOf(sameDay), '与不校正（仍按 3/15）不同', `${gzOf(cross)} vs ${gzOf(sameDay)}`);
ok(cross.pillars[3].zhi === '戌', '时支应为戌（20:59 落 19–21）', cross.pillars[3].zhi);

console.log('\n=== 5. 夜子时（23:00 后）日柱归次日 ===');
const zi = baziOf({ year: 2024, month: 6, day: 10, hour: 23, minute: 30, lon: 120 });
const nextNoon = baziOf({ year: 2024, month: 6, day: 11, hour: 12, minute: 0, lon: 120 });
const before = baziOf({ year: 2024, month: 6, day: 10, hour: 22, minute: 30, lon: 120 });
console.log(`  6/10 22:30 → 日柱 ${gzOf(before)}  时柱 ${before.pillars[3].gan}${before.pillars[3].zhi}`);
console.log(`  6/10 23:30 → 日柱 ${gzOf(zi)}  时柱 ${zi.pillars[3].gan}${zi.pillars[3].zhi}`);
console.log(`  6/11 12:00 → 日柱 ${gzOf(nextNoon)}`);
ok(gzOf(zi) === gzOf(nextNoon), '23:30 日柱应等于 6/11 的日柱', `${gzOf(zi)} vs ${gzOf(nextNoon)}`);
ok(gzOf(before) !== gzOf(zi), '22:30 与 23:30 日柱应不同', `${gzOf(before)} vs ${gzOf(zi)}`);
ok(zi.pillars[3].zhi === '子', '23:30 时支为子', zi.pillars[3].zhi);

console.log(`\n${fail === 0 ? '全部通过 ✓' : `${fail} 项未通过 ✗`}`);
process.exit(fail === 0 ? 0 : 1);
