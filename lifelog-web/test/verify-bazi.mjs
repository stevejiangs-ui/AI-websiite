/* 排盘校验：用公开、可复核的命例，检查四柱是否排对。
   运行：node verify-bazi.mjs */
import { baziOf, dailyFortune } from '../src/bazi.js';
import { equationOfTime } from '../src/astro.js';

const fmt = (r) => r.pillars.map((p) => p.gan + p.zhi).join(' ');

const cases = [
  /* 日柱校验：日柱只跟公历日有关，最容易验。
     1900-01-31 = 甲辰日（基准） */
  { name: '基准日', b: { year: 1900, month: 1, day: 31, hour: 12, minute: 0, lon: 116.41 }, day: '甲辰' },
  /* 每 60 天循环一次，基准 +60 天仍是甲辰 */
  { name: '+60 天', b: { year: 1900, month: 4, day: 1, hour: 12, minute: 0, lon: 116.41 }, day: '甲辰' },
  /* 2000-01-01 是戊午日（多源公开数据） */
  { name: '2000 元旦', b: { year: 2000, month: 1, day: 1, hour: 12, minute: 0, lon: 116.41 }, day: '戊午' },
  /* 2024-01-01 是甲子日 */
  { name: '2024 元旦', b: { year: 2024, month: 1, day: 1, hour: 12, minute: 0, lon: 116.41 }, day: '甲子' }
];

console.log('=== 日柱校验 ===');
let ok = 0;
for (const c of cases) {
  const r = baziOf(c.b);
  const got = r.pillars[2].gan + r.pillars[2].zhi;
  const pass = got === c.day;
  if (pass) ok += 1;
  console.log(`${pass ? '✓' : '✗'} ${c.name} 得 ${got} 期望 ${c.day}`);
}

/* 年柱校验：立春前后的分界。2025 立春 2/3 22:10，2/3 12:00 应属甲辰年，2/4 12:00 应属乙巳年 */
console.log('\n=== 年柱立春分界校验（2025 立春 = 2/3 22:10）===');
const a = baziOf({ year: 2025, month: 2, day: 3, hour: 12, minute: 0, lon: 116.41 });
const b = baziOf({ year: 2025, month: 2, day: 4, hour: 12, minute: 0, lon: 116.41 });
console.log(`2/3 12:00 → 年柱 ${a.pillars[0].gan}${a.pillars[0].zhi}（应为甲辰） ${a.pillars[0].gan + a.pillars[0].zhi === '甲辰' ? '✓' : '✗'}`);
console.log(`2/4 12:00 → 年柱 ${b.pillars[0].gan}${b.pillars[0].zhi}（应为乙巳） ${b.pillars[0].gan + b.pillars[0].zhi === '乙巳' ? '✓' : '✗'}`);

/* 月柱校验：2024 清明 4/4 15:02，前一小时应属丁卯月，后一小时属戊辰月 */
console.log('\n=== 月柱交节分界校验（2024 清明 = 4/4 15:02）===');
const m1 = baziOf({ year: 2024, month: 4, day: 4, hour: 14, minute: 0, lon: 116.41 });
const m2 = baziOf({ year: 2024, month: 4, day: 4, hour: 16, minute: 0, lon: 116.41 });
console.log(`4/4 14:00 → 月柱 ${m1.pillars[1].gan}${m1.pillars[1].zhi}（应卯月，前面那个节是${m1.jiePrev?.name}）`);
console.log(`4/4 16:00 → 月柱 ${m2.pillars[1].gan}${m2.pillars[1].zhi}（应辰月，前面那个节是${m2.jiePrev?.name}）`);
console.log(`分界正确: ${m1.pillars[1].zhi === '卯' && m2.pillars[1].zhi === '辰' ? '✓' : '✗'}`);

/* 时柱校验：真太阳时会让时柱变。同一个人，只改出生地 */
console.log('\n=== 时柱真太阳时影响（同一时刻，不同出生地）===');
const base = { year: 1990, month: 6, day: 15, hour: 8, minute: 0 };
for (const [place, lon] of [['北京', 116.41], ['上海', 121.47], ['乌鲁木齐', 87.62], ['拉萨', 91.13]]) {
  const r = baziOf({ ...base, lon, place });
  const th = r.trueSolarHour;
  const hh = Math.floor(th);
  const mm = Math.round((th - hh) * 60);
  console.log(`${place.padEnd(4)} 真太阳时 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}  校正 ${r.solarOffsetMin > 0 ? '+' : ''}${r.solarOffsetMin} 分  时柱 ${r.pillars[3].gan}${r.pillars[3].zhi}`);
}

/* 均时差极值检查：一年内应在 ±16.5 分钟内 */
console.log('\n=== 均时差范围检查（应约在 -14 ~ +16.5 分）===');
let mn = 99;
let mx = -99;
for (let d = 0; d < 365; d += 1) {
  const ms = Date.UTC(2024, 0, 1) + d * 86400000;
  const e = equationOfTime(ms / 86400000 + 2440587.5);
  mn = Math.min(mn, e);
  mx = Math.max(mx, e);
}
console.log(`范围 ${mn.toFixed(2)} ~ ${mx.toFixed(2)} 分  ${mn > -15 && mx < 17 ? '✓' : '✗'}`);

/* 打印一个完整盘，人眼核对 */
console.log('\n=== 样例盘（北京 1990-06-15 08:00）===');
const demo = baziOf({ year: 1990, month: 6, day: 15, hour: 8, minute: 0, lon: 116.41, place: '北京' });
console.log('四柱:', fmt(demo));
console.log('日主:', demo.dayMaster, demo.dayMasterWuxing, '| 属相:', demo.animal);
console.log('五行:', demo.wuxing);
console.log('上一节:', demo.jiePrev?.name, demo.jiePrev?.at, '| 下一节:', demo.jieNext?.name, demo.jieNext?.at);
console.log('真太阳时:', demo.trueSolarHour.toFixed(3), '时', `（经度 ${demo.lonPartMin} 分 + 均时差 ${demo.eotPartMin} 分）`);

console.log('\n日柱 4 项中通过', ok, '项');
