import { h, render, toast, state, setState, todayStr, keepFocus } from './store.js';
import { FACETS, facetOf } from './facets.js';
import { dailyFortune, baziOf, relationToDayMaster, monthCalendar, WUXING_COLORS, GAN_WUXING, ZHI_WUXING, yearFortune, dayunList } from './bazi.js';
import { CITIES, findCity, inferCity, searchCities } from './birthplace.js';
import { loadBirthInfo, saveBirthInfo, getSelfProfile, saveSelfProfile } from './cloud.js';
import { favorableGods, periodFortune, applyAdvice } from './yongshen.js';

/* 八字结果缓存。必须声明在 ensureBirth（第 40 行附近就会写 baziCacheKey）之前，
   否则首次进首页触发它时会撞上暂时性死区，整页白屏。 */
let baziCache = null;
let baziCacheKey = '';

/* 五行关系的单字缩写。月历格子会用到，必须定义在使用之前 */
const REL_SHORT = { same: '同', help: '助', out: '耗', press: '压', gain: '控' };

/* 日历当前浏览的年月，默认本月 */
let calCursor = null;
function cursor() {
  if (!calCursor) {
    const d = new Date();
    calCursor = { y: d.getFullYear(), m: d.getMonth() + 1 };
  }
  return calCursor;
}

/* ---------------- 运势 ---------------- */

const BIRTH_KEY = 'lifelog-birth.v1';

function loadBirth() {
  try {
    return JSON.parse(localStorage.getItem(BIRTH_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function saveBirth(b) {
  try {
    localStorage.setItem(BIRTH_KEY, JSON.stringify(b));
  } catch (e) {
    /* ignore */
  }
}

/** 本地先读，云端覆盖（云端更新更权威，跨设备同步靠它） */
export function ensureBirth() {
  if (state.birth === undefined) state.birth = loadBirth();
  if (!state.birthLoaded && state.birth === null) {
    /* 本地没有，尝试从云端拉一次 */
    state.birthLoaded = true;
    loadBirthInfo()
      .then((b) => {
        if (b) {
          state.birth = b;
          saveBirth(b);
          baziCacheKey = '';
          render();
        }
      })
      .catch(() => {});
  } else {
    state.birthLoaded = true;
  }
  return state.birth;
}

function computeBazi(b) {
  const key = JSON.stringify(b);
  if (baziCacheKey === key) return baziCache;
  baziCache = baziOf(b);
  baziCacheKey = key;
  return baziCache;
}

function pillView(p, dayMaster) {
  return h(
    'div',
    { class: 'pillar' },
    h('div', { class: 'pillar-label' }, p.label),
    h('div', { class: 'pillar-char', style: `color:${WUXING_COLORS[GAN_WUXING[p.gan]]}` }, p.gan),
    h('div', { class: 'pillar-char', style: `color:${WUXING_COLORS[GAN_WUXING[p.zhi?.[0] || p.gan]] || '#5c5852'}` }, p.zhi)
  );
}

/* ---------------- 喜用神卡 ---------------- */

const WX_TONE = { 木: '#4f8f4a', 火: '#c05a4a', 土: '#a8843c', 金: '#8a8a8a', 水: '#4a6fa5' };

function wxChip(wx, role, tone) {
  return h(
    'span',
    {
      class: 'wx-chip',
      style: `border-color:${WX_TONE[wx]};color:${WX_TONE[wx]}`,
      title: role || ''
    },
    h('b', {}, wx),
    role ? h('span', { class: 'wx-chip-role' }, role) : null
  );
}

function yongshenCard(bz, fg) {
  if (!fg) return null;
  const advice = applyAdvice(fg);

  return h(
    'div',
    { class: 'card ys-card' },
    h(
      'div',
      { class: 'row-between' },
      h('h3', { class: 'card-title', style: 'margin:0' }, '我的喜用神'),
      h('span', { class: 'muted', style: 'font-size:12px' }, `日主 ${fg.dayMaster}（${fg.dayMasterWuxing}）· ${fg.verdict}`)
    ),

    /* 三行结论 */
    h(
      'div',
      { class: 'ys-rows' },
      h(
        'div',
        { class: 'ys-row' },
        h('span', { class: 'ys-k' }, '用神'),
        h('span', { class: 'ys-v' }, ...fg.useful.map((u) => wxChip(u.wx, u.role, 'use')))
      ),
      fg.favorable.length
        ? h(
            'div',
            { class: 'ys-row' },
            h('span', { class: 'ys-k' }, '喜神'),
            h('span', { class: 'ys-v' }, ...fg.favorable.map((u) => wxChip(u.wx, u.role, 'fav')))
          )
        : null,
      h(
        'div',
        { class: 'ys-row' },
        h('span', { class: 'ys-k' }, '忌神'),
        h('span', { class: 'ys-v' }, ...fg.avoid.map((u) => wxChip(u.wx, u.role, 'avoid')))
      )
    ),

    /* 推断依据：不甩结论，让人看懂为什么 */
    h(
      'div',
      { class: 'ys-why' },
      h('div', { class: 'muted', style: 'font-size:11.5px;margin-bottom:4px' }, '推断依据（扶抑法）'),
      ...fg.reasoning.map((r) => h('div', { style: 'font-size:12.5px;line-height:1.75' }, '· ' + r)),
      h(
        'div',
        { class: 'muted', style: 'font-size:12px;margin-top:4px' },
        `五行占比：${Object.entries(fg.pct).map(([k, v]) => `${k}${v}%`).join('　')}`
      )
    ),

    /* 落到生活里的四条 */
    h(
      'div',
      { class: 'ys-advice' },
      ...advice.map((a) =>
        h(
          'div',
          { class: 'ys-adv' },
          h('div', { class: 'ys-adv-t' }, a.title),
          h('div', { class: 'ys-adv-x' }, a.text)
        )
      )
    ),

    h(
      'p',
      { class: 'hint', style: 'margin-top:10px' },
      '取用神有不同流派，这里用最主流的扶抑法（先判旺衰，再定补泄）。结论可参考，别当铁律。'
    )
  );
}

/* ---------------- 四级运势（大运 / 年 / 月 / 日） ---------------- */

function gradeClass(k) {
  return k === 'good' ? 'is-good' : k === 'fair' ? 'is-fair' : k === 'bad' ? 'is-bad' : k === 'warn' ? 'is-warn' : 'is-flat';
}

function levelBlock(label, lv, extra) {
  return h(
    'div',
    { class: 'lv-block ' + gradeClass(lv.gradeKey) },
    h('div', { class: 'lv-label' }, label),
    h('div', { class: 'lv-gz' }, lv.gz),
    h('div', { class: 'lv-grade' }, lv.grade),
    h(
      'div',
      { class: 'lv-meta' },
      lv.ganWx ? `${lv.ganWx}干` : '',
      lv.zhiWx ? ` · ${lv.zhiWx}支` : '',
      lv.shishen ? ` · ${lv.shishen}` : ''
    ),
    extra ? h('div', { class: 'lv-extra' }, extra) : null
  );
}

/** 本人资料（性别等），供大运排向使用；异步拉一次，缓存进 state */
export function ensureSelfProfile() {
  if (state.selfProfile === undefined) {
    state.selfProfile = null;
    getSelfProfile()
      .then((row) => {
        state.selfProfile = row ? row.data || {} : {};
        render();
      })
      .catch(() => {});
  }
  return state.selfProfile || {};
}

export function genderOf(sp) {
  const g = sp && sp.gender;
  if (g === '男' || g === 'male' || g === 'M') return 'male';
  if (g === '女' || g === 'female' || g === 'F') return 'female';
  return '';
}

/** 设置性别（男命 / 女命）。存进本人档案 self_profile.gender，
    和「圈子 → 我」的资料是同一个字段，两边改哪边都行。 */
export async function setGender(g) {
  const label = g === 'female' ? '女' : '男';
  const row = await getSelfProfile();
  const data = { ...(row?.data || {}), gender: label };
  await saveSelfProfile(data);
  state.selfProfile = data;
  render();
}

/** 男 / 女 切换按钮：八字页、运势页、生辰编辑里共用 */
export function genderToggle({ compact = false } = {}) {
  const g = genderOf(ensureSelfProfile());
  const pick = async (v) => {
    if (v === g) return;
    try {
      await setGender(v);
      toast(`已设为${v === 'male' ? '男' : '女'}命，大运已按${v === 'male' ? '男' : '女'}命重排`);
    } catch (e) {
      toast('保存失败：' + (e.message || e), 'err');
    }
  };
  return h(
    'div',
    { class: 'seg', title: '性别决定大运顺排还是逆排' },
    ...[
      ['male', compact ? '男' : '男命'],
      ['female', compact ? '女' : '女命']
    ].map(([v, l]) => h('button', { class: g === v ? 'on' : '', onclick: () => pick(v) }, l))
  );
}

/** 四级分区的小标题 */
function secTitle(txt) {
  return h('div', { class: 'section-label', style: 'margin:22px 0 4px;font-size:12.5px' }, txt);
}

/* 大运运势：从月柱顺/逆排，每十年一柱，标出当前所在的大运 */
function dayunCard(bz) {
  const sp = ensureSelfProfile();
  const gender = genderOf(sp);
  let du;
  try {
    du = dayunList(bz, gender);
  } catch (e) {
    return null;
  }
  const nowAge = state.birth ? new Date().getFullYear() - state.birth.year : null;
  const isNow = (d) => nowAge != null && nowAge >= d.startAge && nowAge <= d.endAge + 1;

  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'row-between' },
      h('h3', { class: 'card-title', style: 'margin:0' }, '大运运势'),
      h(
        'div',
        { class: 'row', style: 'gap:8px' },
        h('span', { class: 'muted', style: 'font-size:12px' }, `${du.forward ? '顺排' : '逆排'} · ${du.startAge} 岁起运`),
        genderToggle({ compact: true })
      )
    ),
    h(
      'div',
      { class: 'du-row' },
      ...du.list.map((d) =>
        h(
          'div',
          { class: 'du-col' + (isNow(d) ? ' on' : '') },
          h('div', { class: 'du-age' }, `${Math.floor(d.startAge)}–${Math.floor(d.endAge)}`),
          h('div', { class: 'du-gz' },
            h('span', { style: `color:${WUXING_COLORS[d.wx]}` }, d.gan),
            h('span', { style: `color:${WUXING_COLORS[d.zhiWx]};opacity:.85` }, d.zhi)
          ),
          h('div', { class: 'du-god' }, d.god === '日主' ? '比肩' : d.god),
          isNow(d) ? h('div', { class: 'du-now' }, '当前') : null
        )
      )
    ),
    h(
      'p',
      { class: 'hint', style: 'margin-top:12px' },
      du.genderKnown
        ? `按${gender === 'male' ? '男' : '女'}命${du.forward ? '顺' : '逆'}排，起运岁数 = 距${du.forward ? '下一' : '上一'}节天数 ÷ 3。大运管十年大方向，流年看当年细账。`
        : '还没选性别，先按男命排了。阳年男顺排、阴年男逆排，女命相反——点右上角「男 / 女」选一下就会自动改正。'
    )
  );
}

function yearCard(pf, yf) {
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'lv-row' },
      levelBlock('流年', pf.year, yf ? `属${yf.animal}` : '')
    ),
    h(
      'p',
      { style: 'margin:12px 0 0;font-size:13px;line-height:1.8' },
      yf
        ? `${yf.year} 年是 ${yf.yearGz}（${yf.animal}）年，全年大方向看这根柱子：它落在你的喜用神一侧就是顺风年，落在忌神一侧就多守少攻。`
        : ''
    )
  );
}

function monthCard(pf, yf) {
  const curMonthIdx = yf ? yf.months.findIndex((m) => m.gz === pf.month.gz) : -1;
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'lv-row' },
      levelBlock('流月', pf.month, curMonthIdx >= 0 ? `第 ${curMonthIdx + 1} 月建` : '')
    ),
    h(
      'p',
      { style: 'margin:12px 0 0;font-size:13px;line-height:1.8' },
      `当月干支 ${pf.month.gz}，是当年十二步里的一步：月令顺则整月节奏快，月令逆则这一个月更适合收尾和调整。`
    )
  );
}

function dayCard(pf, daily) {
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'lv-row' }, levelBlock('流日', pf.day, daily ? `${daily.zhishen}日` : '')),

    /* 十神场景：把干支翻成人话 */
    pf.day.scene
      ? h(
          'div',
          { class: 'pf-scene' },
          h('span', { class: 'pf-scene-k' }, `今日十神：${pf.day.shishen}`),
          h('span', {}, pf.day.scene.scene),
          h('span', { class: 'muted' }, '　→ '),
          h('span', {}, pf.day.scene.do)
        )
      : null,

    /* 宜 / 忌 */
    h(
      'div',
      { class: 'fortune-two', style: 'margin-top:14px' },
      h(
        'div',
        { class: 'pf-yiji' },
        h('div', { class: 'pf-yiji-t good' }, '宜'),
        h('div', { class: 'chip-row' }, ...pf.yi.map((x) => h('span', { class: 'chip chip-good' }, x)))
      ),
      h(
        'div',
        { class: 'pf-yiji' },
        h('div', { class: 'pf-yiji-t bad' }, '忌'),
        h('div', { class: 'chip-row' }, ...pf.ji.map((x) => h('span', { class: 'chip chip-bad' }, x)))
      )
    ),

    /* 注意什么 */
    pf.cautions.length
      ? h(
          'div',
          { class: 'pf-caution' },
          h('div', { class: 'pf-caution-t' }, '要注意'),
          ...pf.cautions.map((c) => h('div', { class: 'pf-caution-x' }, '· ' + c))
        )
      : null,

    h(
      'p',
      { class: 'hint', style: 'margin-top:12px' },
      '宜忌不是抽签：它按你的喜用神来判——落在用神那一行的日子判顺，落在忌神那一行的日子判守。所以同一天，不同的人结论不同。'
    )
  );
}


export function fortuneView() {
  const birth = ensureBirth();
  const today = new Date();
  const daily = dailyFortune(today);
  const bz = birth ? computeBazi(birth) : null;
  const yf = yearFortune(daily.solarYear);

  let fg = null;
  let pf = null;
  if (bz) {
    try {
      fg = favorableGods(bz);
      pf = periodFortune(fg, bz.dayMaster, { yearGz: daily.yearGz, monthGz: daily.monthGz, dayGz: daily.dayGz }, bz);
    } catch (e) {
      fg = null;
      pf = null;
    }
  }

  const rel = bz ? relationToDayMaster(bz.dayMasterWuxing, daily.dayWuxing) : null;

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h('h1', {}, '运势'),
        h('p', { class: 'desc' }, `${daily.date} · ${daily.yearGz}年 ${daily.monthGz}月 ${daily.dayGz}日`)
      ),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'button',
          {
            class: 'btn btn-ghost',
            onclick: () => import('./view-expert.js').then((m) => m.openExpert('bazi'))
          },
          '🧑‍💼 问命理师'
        ),
        h('button', { class: 'btn btn-ghost', onclick: () => setState({ view: 'bazi' }) }, '八字自评'),
        h('button', { class: 'btn btn-ghost', onclick: () => openBirth() }, birth ? '改生辰' : '填生辰八字')
      )
    ),

    h(
      'div',
      { class: 'fortune-hero' },
      h(
        'div',
        { class: 'fortune-day' },
        h('div', { class: 'fortune-day-char' }, daily.dayGz),
        h('div', { class: 'fortune-day-meta' }, `${daily.animal}年 · 日干五行 ${daily.dayWuxing}`)
      ),
      pf
        ? h(
            'div',
            { class: 'fortune-luck ' + gradeClass(pf.day.gradeKey) },
            h('div', { class: 'fortune-luck-n' }, pf.day.grade),
            h('div', { class: 'fortune-luck-t' }, `综合 ${pf.composite}`)
          )
        : h(
            'div',
            { class: 'fortune-luck ' + (daily.luck === '吉' ? 'is-good' : daily.luck === '凶' ? 'is-bad' : '') },
            h('div', { class: 'fortune-luck-n' }, daily.zhishen),
            h('div', { class: 'fortune-luck-t' }, daily.luck === '吉' ? '偏顺' : daily.luck === '凶' ? '宜守' : '平常')
          )
    ),

    /* 有生辰 → 大运/年/月/日四级 + 喜用神；没生辰 → 通用提示 + 去填 */
    pf
      ? [
          secTitle('大运运势 · 十年一柱'),
          dayunCard(bz),
          secTitle(`今年运势 · ${yf ? yf.yearGz : ''}年`),
          yearCard(pf, yf),
          secTitle(`今月运势 · ${pf.month.gz}月`),
          monthCard(pf, yf),
          secTitle(`今日运势 · ${daily.dayGz}日`),
          dayCard(pf, daily)
        ]
      : rel && rel.text
        ? h(
            'div',
            { class: 'card', style: 'margin-top:14px' },
            h('h3', { class: 'card-title' }, '对你的影响'),
            h(
              'p',
              { style: 'margin:0;font-size:13.5px;line-height:1.8' },
              `你日主属${bz.dayMasterWuxing}（${bz.dayMaster}），今日日干属${daily.dayWuxing}，${rel.text}。`
            )
          )
        : null,

    /* 没生辰时用通历的宜忌兜底 */
    pf
      ? null
      : h(
          'div',
          { class: 'fortune-two' },
          h(
            'div',
            { class: 'card' },
            h('h3', { class: 'card-title' }, '宜（通历，未必适合你）'),
            h('div', { class: 'chip-row' }, ...daily.yi.map((x) => h('span', { class: 'chip chip-good' }, x)))
          ),
          h(
            'div',
            { class: 'card' },
            h('h3', { class: 'card-title' }, '忌（通历）'),
            h('div', { class: 'chip-row' }, ...daily.ji.map((x) => h('span', { class: 'chip chip-bad' }, x)))
          )
        ),

    fg ? yongshenCard(bz, fg) : null,

    calendarCard(bz ? bz.dayMasterWuxing : ''),

    bz
      ? h(
          'div',
          { class: 'card' },
          h(
            'div',
            { class: 'row-between' },
            h('h3', { class: 'card-title', style: 'margin:0' }, '八字排盘'),
            h('span', { class: 'muted', style: 'font-size:12px' }, `日主 ${bz.dayMaster}（${bz.dayMasterWuxing}）· 属${bz.animal}`)
          ),
          h('div', { class: 'pillar-row' }, ...bz.pillars.map((p) => pillView(p, bz.dayMaster))),
          h(
            'div',
            { style: 'margin-top:16px' },
            h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, '五行分布（含地支藏干，月令加权）'),
            ...(fg
              ? [
                  h(
                    'div',
                    { class: 'wuxing-bar' },
                    ...Object.entries(fg.pct)
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) =>
                        h(
                          'div',
                          { class: 'wuxing-seg', style: `flex:${v};background:${WUXING_COLORS[k]}`, title: `${k} ${v}%` },
                          h('span', {}, k)
                        )
                      )
                  ),
                  h(
                    'div',
                    { class: 'muted', style: 'margin-top:6px;font-size:11.5px' },
                    Object.entries(fg.pct).map(([k, v]) => `${k} ${v}%`).join('　')
                  )
                ]
              : [
                  h(
                    'div',
                    { class: 'wuxing-bar' },
                    ...Object.entries(bz.wuxing)
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) =>
                        h('div', { class: 'wuxing-seg', style: `flex:${v};background:${WUXING_COLORS[k]}`, title: `${k} ${v}` }, h('span', {}, k))
                      )
                  )
                ]),
            fg
              ? h('p', { class: 'muted', style: 'margin:10px 0 0;font-size:12.5px' }, `${bz.strongest[0]}最旺，${bz.weakest[0]}最弱。`)
              : null
          ),
          h(
            'div',
            { style: 'margin-top:16px' },
            h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, '十神'),
            h(
              'div',
              { class: 'chip-row' },
              ...bz.shishen.map((s) => h('span', { class: 'chip' }, `${s.label} ${s.gan} ${s.god}`))
            )
          ),
          h(
            'p',
            { class: 'hint', style: 'margin-top:16px' },
            '年柱以立春精确时刻为界，月柱按十二节交节时刻，时柱用出生地真太阳时（含 1986–1991 夏令时校正）。交节前后一两小时内出生的人，建议核对出生时刻。'
          )
        )
      : h(
          'div',
          { class: 'card' },
          h('h3', { class: 'card-title' }, '想看更准的？'),
          h(
            'p',
            { class: 'muted', style: 'margin:0 0 14px' },
            '填入出生年月日时，可以排出八字、算出喜用神，再按你的用神给出当年/当月/当日的运势与宜忌。'
          ),
          h('button', { class: 'btn btn-accent', onclick: () => openBirth() }, '填生辰八字')
        ),

    birthEditor()
  );
}

/* ---------------- 运势日历 ---------------- */

function calendarCard(dayMasterWuxing) {
  const c = cursor();
  const days = monthCalendar(c.y, c.m, dayMasterWuxing);
  const todayKey = todayStr();
  /* 周一起始，周日收尾 */
  const lead = (days[0].weekday + 6) % 7;

  const shiftCal = (delta) => {
    const d = new Date(c.y, c.m - 1 + delta, 1);
    calCursor = { y: d.getFullYear(), m: d.getMonth() + 1 };
    render();
  };

  return h(
    'div',
    { class: 'card cal-card' },
    h(
      'div',
      { class: 'cal-head' },
      h('button', { class: 'cal-nav', onclick: () => shiftCal(-1), title: '上个月' }, '‹'),
      h('div', { class: 'cal-title' }, `${c.y} 年 ${c.m} 月`),
      h('button', { class: 'cal-nav', onclick: () => shiftCal(1), title: '下个月' }, '›'),
      h('span', { class: 'muted', style: 'margin-left:12px;font-size:11.5px' }, dayMasterWuxing ? '按你的日主标色' : '填生辰后可按日主标色')
    ),
    h(
      'div',
      { class: 'cal-grid' },
      ...['一', '二', '三', '四', '五', '六', '日'].map((w) => h('div', { class: 'cal-wd' }, w)),
      ...Array.from({ length: lead }, () => h('div', { class: 'cal-cell empty' })),
      ...days.map((d) => {
        const isToday = d.key === todayKey;
        const cls = ['cal-cell', d.score >= 2 ? 'good' : d.score <= -1 ? 'bad' : 'flat', isToday ? 'today' : ''].join(' ');
        return h(
          'div',
          { class: cls, title: `${d.key}　${d.gz}日　${d.zhishen}　${d.relText || ''}` },
          h('div', { class: 'cal-day' }, String(d.day)),
          h('div', { class: 'cal-gz', style: `color:${WUXING_COLORS[d.dayWuxing] || '#5c5852'}` }, d.gz),
          d.rel ? h('div', { class: 'cal-rel' }, REL_SHORT[d.rel] || '') : null
        );
      })
    ),
    h(
      'div',
      { class: 'cal-legend' },
      h('span', { class: 'cal-lg good' }, '偏顺'),
      h('span', { class: 'cal-lg flat' }, '平常'),
      h('span', { class: 'cal-lg bad' }, '宜守'),
      h('span', { class: 'cal-lg today' }, '今天')
    ),
    h(
      'p',
      { class: 'hint', style: 'margin-top:10px' },
      dayMasterWuxing
        ? '格子里的小字是当天五行与你的关系：助＝生我，同＝比和，耗＝我生，压＝克我，控＝我克。配色只做参考，不构成任何决定依据。'
        : '填入生辰后，每格会额外标出当天五行对你是助力还是消耗。'
    )
  );
}

/* 生辰编辑 */
let birthForm = null;
export function openBirth() {
  const b = ensureBirth() || { year: 1990, month: 1, day: 1, hour: 12, minute: 0, lon: 116.41, place: '北京' };
  birthForm = {
    year: b.year ?? 1990,
    month: b.month ?? 1,
    day: b.day ?? 1,
    hour: b.hour ?? 12,
    minute: b.minute ?? 0,
    lon: b.lon ?? 116.41,
    place: b.place || '北京',
    cityQuery: b.place || '北京',
    useTrueSolar: b.useTrueSolar !== false,
    gender: genderOf(ensureSelfProfile()) || '',
    err: ''
  };
  render();
}

export function birthEditor() {
  if (!birthForm) return null;
  const f = birthForm;

  /* 实时预览：让用户一边填一边看到真太阳时和时柱，不用保存才知道 */
  const preview = (() => {
    try {
      return baziOf({
        year: f.year,
        month: f.month,
        day: f.day,
        hour: f.hour,
        minute: f.minute,
        lon: f.lon,
        place: f.place,
        useTrueSolar: f.useTrueSolar
      });
    } catch (e) {
      return null;
    }
  })();

  const num = (k, label, min, max, ph) =>
    h(
      'div',
      { style: 'flex:1;min-width:70px' },
      h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, label),
      h('input', {
        class: 'input',
        id: 'birth-' + k,
        type: 'number',
        min: String(min),
        max: String(max),
        placeholder: ph,
        value: f[k] ?? '',
        oninput: (ev) => {
          birthForm[k] = ev.target.value === '' ? '' : Number(ev.target.value);
          /* keepFocus 会记下焦点和光标位置，等 render 重建后还原 ——
             直接 render() 会把输入框换成新节点，打一个字就失焦。 */
          keepFocus('birth-' + k);
        }
      })
    );

  /* 出生地：中文可搜索的城市选择器，覆盖国内主要城市 + 全球主要城市。
     关键修复：中文输入法组词期间（composition）绝不能重渲染 ——
     之前打「顺德」打到一半 DOM 被重建，组词被打断，看起来就是「输入不了」。 */
  const searchHits = f.cityQuery ? searchCities(f.cityQuery) : [];
  const inferred = f.cityQuery ? inferCity(f.cityQuery) : null;
  const showList = f.cityQuery && String(f.cityQuery).trim() && searchHits.length > 0 && !(inferred && inferred.city.name === f.cityQuery);

  const howText = (how) =>
    how === 'address' ? '地址里含城市名，直接取用'
    : how === 'district' ? '按区县定位到所属城市'
    : how === 'province' ? '只识别到省份，暂按省会经度（可手改）'
    : '';

  let composing = false;
  const cityPicker = h(
    'div',
    { style: 'position:relative' },
    h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, '出生地（输入中文搜索城市，全球主要城市都可选）'),
    h('input', {
      class: 'input',
      id: 'birth-city',
      placeholder: '如 顺德 / 杭州 / 新加坡 / 洛杉矶',
      value: f.cityQuery ?? '',
      autocomplete: 'off',
      oncompositionstart: () => {
        composing = true;
      },
      oncompositionend: (ev) => {
        composing = false;
        birthForm.cityQuery = ev.target.value;
        keepFocus('birth-city');
      },
      oninput: (ev) => {
        birthForm.cityQuery = ev.target.value;
        /* 输入法组词中只记值不渲染；组词结束（或英文直接输入）才重建列表 */
        if (!composing) keepFocus('birth-city');
      }
    }),
    /* 快捷候选：没输入时给一组常用城市，点一下就选 */
    !f.cityQuery
      ? h(
          'div',
          { class: 'chip-row', style: 'margin-top:8px' },
          ...['北京', '上海', '广州', '深圳', '佛山', '杭州', '成都', '香港', '新加坡', '纽约'].map((n) => {
            const c = CITIES.find((x) => x.name === n);
            if (!c) return null;
            return h(
              'button',
              {
                class: 'chip',
                onclick: () => {
                  birthForm.place = c.name;
                  birthForm.lon = c.lon;
                  birthForm.cityQuery = c.name;
                  birthForm.autoCity = c.name;
                  render();
                }
              },
              n
            );
          })
        )
      : null,
    inferred
      ? h(
          'div',
          { class: 'muted', style: 'font-size:11.5px;margin-top:5px;line-height:1.6' },
          `已识别：${inferred.city.name}（${inferred.city.prov}）· 东经 ${inferred.city.lon}°　—　${howText(inferred.how)}`
        )
      : f.cityQuery && !searchHits.length
        ? h(
            'div',
            { style: 'font-size:11.5px;margin-top:5px;color:#b5762a' },
            '列表里没有这个城市。可手动填下面经度（东经为正），或换个说法再搜。'
          )
        : null,
    showList
      ? h(
          'div',
          {
            style:
              'position:absolute;left:0;right:0;top:100%;z-index:30;background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-top:4px;max-height:220px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.12)'
          },
          searchHits.map((c) =>
            h(
              'div',
              {
                style: 'padding:8px 12px;cursor:pointer;display:flex;gap:8px;align-items:baseline',
                onmouseenter: (ev) => (ev.currentTarget.style.background = 'var(--hover)'),
                onmouseleave: (ev) => (ev.currentTarget.style.background = 'transparent'),
                onmousedown: (ev) => ev.preventDefault(),
                onclick: () => {
                  birthForm.place = c.name;
                  birthForm.lon = c.lon;
                  birthForm.cityQuery = c.name;
                  birthForm.autoCity = c.name;
                  render();
                }
              },
              h('span', {}, c.name),
              h('span', { class: 'muted', style: 'font-size:12px' },
                `${c.prov} · ${c.lon >= 0 ? '东经' : '西经'} ${Math.abs(c.lon)}°` +
                ((c.alias || []).some((a) => String(f.cityQuery).includes(a)) ? ` · 含 ${c.alias.filter((a) => String(f.cityQuery).includes(a))[0]}` : ''))
            )
          )
        )
      : null
  );

  return h(
    'div',
    { class: 'editor', onclick: (ev) => ev.target.classList.contains('editor') && ((birthForm = null), render()) },
    h(
      'div',
      { class: 'editor-panel editor-panel-narrow' },
      h(
        'div',
        { class: 'editor-head' },
        h('span', {}, '生辰八字'),
        h('div', { style: 'flex:1' }),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ((birthForm = null), render()) }, '关闭')
      ),
      h(
        'div',
        { class: 'editor-body' },
        h(
          'p',
          { class: 'muted', style: 'margin:0 0 14px' },
          '按公历（阳历）填出生时刻，是当时的钟表时间（含夏令时那几年的钟表读数）。时辰按真太阳时算，必须给出出生地。'
        ),
        h(
          'div',
          { style: 'margin-bottom:14px' },
          h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, '性别（决定大运顺排还是逆排）'),
          h(
            'div',
            { class: 'seg' },
            ...[
              ['male', '男'],
              ['female', '女']
            ].map(([v, l]) =>
              h(
                'button',
                {
                  class: f.gender === v ? 'on' : '',
                  style: 'min-width:64px',
                  onclick: () => {
                    birthForm.gender = v;
                    birthForm.err = '';
                    render();
                  }
                },
                l
              )
            )
          )
        ),
        h(
          'div',
          { class: 'row', style: 'gap:10px' },
          num('year', '年', 1900, 2100, '1990'),
          num('month', '月', 1, 12, '1'),
          num('day', '日', 1, 31, '1')
        ),
        h('div', { class: 'gap8' }),
        h('div', { class: 'row', style: 'gap:10px' }, num('hour', '时', 0, 23, '12'), num('minute', '分', 0, 59, '0'), h('div', { style: 'flex:1' })),
        h('div', { class: 'gap8' }),
        cityPicker,
        h('div', { class: 'gap8' }),
        h(
          'div',
          { class: 'row', style: 'gap:10px;align-items:flex-end' },
          h(
            'div',
            { style: 'flex:1;min-width:110px' },
            h('div', { class: 'muted', style: 'margin-bottom:6px;font-size:12px' }, '经度（东经为正，可手改）'),
            h('input', {
              class: 'input',
              id: 'birth-lon',
              type: 'number',
              step: '0.01',
              placeholder: '116.41',
              value: f.lon ?? '',
              oninput: (ev) => {
                birthForm.lon = ev.target.value === '' ? '' : Number(ev.target.value);
                keepFocus('birth-lon');
              }
            })
          ),
          h(
            'label',
            { style: 'display:flex;align-items:center;gap:6px;padding-bottom:10px;cursor:pointer;white-space:nowrap' },
            h('input', {
              type: 'checkbox',
              checked: f.useTrueSolar !== false,
              onchange: (ev) => {
                birthForm.useTrueSolar = ev.target.checked;
                render();
              }
            }),
            h('span', { class: 'muted', style: 'font-size:13px' }, '用真太阳时')
          )
        ),
        /* 实时预览 */
        preview
          ? h(
              'div',
              {
                style:
                  'margin-top:16px;padding:12px 14px;border-radius:10px;background:var(--hover);font-size:13px;line-height:1.9'
              },
              h('div', { style: 'font-weight:600;margin-bottom:4px' }, '实时预览'),
              h(
                'div',
                {},
                '四柱：',
                h('span', { style: 'letter-spacing:2px;font-weight:600' }, preview.pillars.map((p) => p.gan + p.zhi).join(' ')),
                h('span', { class: 'muted' }, `　（${preview.dayMaster}${preview.dayMasterWuxing}日主 · 属${preview.animal}）`)
              ),
              preview.usedTrueSolar
                ? h(
                    'div',
                    { class: 'muted' },
                    `真太阳时 ${String(Math.floor(preview.trueSolarHour)).padStart(2, '0')}:${String(
                      Math.round((preview.trueSolarHour % 1) * 60)
                    ).padStart(2, '0')}`,
                    `　校正 ${preview.solarOffsetMin >= 0 ? '+' : ''}${preview.solarOffsetMin} 分`,
                    `　（经度 ${preview.lonPartMin >= 0 ? '+' : ''}${preview.lonPartMin} · 均时差 ${preview.eotPartMin >= 0 ? '+' : ''}${preview.eotPartMin}`,
                    preview.dstPartMin ? ` · 夏令时 ${preview.dstPartMin}` : '',
                    preview.dstPartMin ? '）' : '）',
                    h('div', {}, `上一节 ${preview.jiePrev ? preview.jiePrev.name + ' ' + preview.jiePrev.at : '—'}`)
                  )
                : h('div', { class: 'muted' }, '未启用真太阳时，时柱直接按北京钟点算，西部城市会不准。'),
              preview.nearJie
                ? h(
                    'div',
                    { style: 'color:#b5762a;margin-top:4px' },
                    `距下一节（${preview.jieNext.name}）只有 ${preview.daysToNextJie} 天，月柱临界，请再核对出生时刻。`
                  )
                : null
            )
          : null,
        h('div', { class: 'err' }, f.err)
      ),
      h(
        'div',
        { class: 'editor-foot' },
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ((birthForm = null), render()) }, '取消'),
          h(
            'button',
            {
              class: 'btn btn-sm btn-accent',
              onclick: async () => {
                const y = Number(f.year);
                const mo = Number(f.month);
                const d = Number(f.day);
                if (!(y >= 1900 && y <= 2100) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) {
                  birthForm.err = '日期不合法';
                  render();
                  return;
                }
                if (f.gender !== 'male' && f.gender !== 'female') {
                  birthForm.err = '请选择性别（男 / 女），大运的顺逆排要用到';
                  render();
                  return;
                }
                const lon = f.lon === '' ? null : Number(f.lon);
                if (lon == null || !Number.isFinite(lon) || lon < -180 || lon > 180) {
                  birthForm.err = '请选择出生城市，或填一个 −180 到 180 之间的经度';
                  render();
                  return;
                }
                const rec = {
                  year: y,
                  month: mo,
                  day: d,
                  hour: Number(f.hour) || 0,
                  minute: Number(f.minute) || 0,
                  lon,
                  place: f.place || f.cityQuery || '',
                  useTrueSolar: f.useTrueSolar !== false
                };
                /* 本地先存，保证离线也能用；云端失败不影响本地 */
                saveBirth(rec);
                state.birth = rec;
                baziCacheKey = '';
                birthForm = null;
                toast('已保存');
                render();
                const gNew = f.gender;
                try {
                  if (gNew !== genderOf(ensureSelfProfile())) await setGender(gNew);
                  await saveBirthInfo(rec);
                  toast('已同步到云端');
                } catch (e) {
                  toast('本地已存，云端同步失败，稍后会自动重试');
                }
              }
            },
            '保存'
          )
        )
      )
    )
  );
}
