/* 八字自评视图：排盘 + 自我验证 + 问答记录。
   跟「运势」页的分工：运势看日子，这里看你自己。 */

import { h, render, toast, state, setState, todayStr, ask as confirmAsk, askText } from './store.js';
import {
  baziOf,
  daymasterProfile,
  WUXING_COLORS,
  GAN_WUXING,
  ZHI_WUXING,
  ZHI_CANG,
  dailyFortune,
  relationToDayMaster,
  tenGod
} from './bazi.js';
import { favorableGods } from './yongshen.js';
import { ensureBirth, openBirth, birthEditor, genderToggle } from './view-fortune.js';
import {
  SELF_DIMENSIONS,
  ELEMENT_TRAITS,
  loadSelf,
  saveSelf,
  scoreDimensions,
  consistency,
  listBaziQA,
  saveBaziQA,
  deleteBaziQA,
  updateBaziNote
} from './bazi-self.js';
import { streamWithSystem, ensureModel } from './ai.js';

/* 生辰统一走 view-fortune 的 ensureBirth，本地 + 云端一套数据源，
   免得两页各读各的、改了一处另一处不更新。 */
function loadBirth() {
  return ensureBirth();
}

/* 页面局部状态 */
let bz = {
  self: null,
  draft: null,
  answers: {},
  traits: {},
  qa: [],
  qaLoaded: false,
  asking: false,
  err: '',
  q: '',
  view: 'chart' // chart | self | qa
};

export async function loadBaziSelf() {
  bz.self = loadSelf();
  bz.answers = { ...bz.self.answers };
  bz.traits = { ...bz.self.traits };
  try {
    bz.qa = await listBaziQA();
  } catch (e) {
    bz.qa = [];
    bz.err = '问答记录读取失败：' + (e.message || e);
  }
  bz.qaLoaded = true;
  render();
}

function birth() {
  return loadBirth();
}

function computed() {
  const b = birth();
  return b ? baziOf(b) : null;
}

/* ---------------- 视图 ---------------- */

export function baziSelfView() {
  const b = birth();
  const c = b ? computed() : null;

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h('h1', {}, '八字自评'),
        h('p', { class: 'desc' }, '排盘只是起点，准不准由你自己的经验来判')
      ),
      h(
        'div',
        {},
        h(
          'button',
          { class: 'btn btn-sm btn-ghost', onclick: () => import('./view-expert.js').then((m) => m.openExpert('bazi')) },
          '🧑‍💼 问命理师'
        ),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => setState({ view: 'fortune' }) }, '运势')
      )
    ),

    /* 生辰八字常显：不进「我的盘」也能看到自己的四柱，点按钮直接改生辰 */
    c
      ? h(
          'div',
          { class: 'card', style: 'margin-bottom:14px' },
          h(
            'div',
            { class: 'row-between' },
            h('h3', { class: 'card-title', style: 'margin:0' }, '生辰八字'),
            h('div', { class: 'row', style: 'gap:8px' }, genderToggle({ compact: true }), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openBirth() }, '✎ 改生辰'))
          ),
          h(
            'div',
            { class: 'pillar-row', style: 'margin-top:12px' },
            ...c.pillars.map((p, i) => {
              const ss = (c.shishen || [])[i] || {};
              const ganWx = GAN_WUXING[p.gan];
              const zhiWx = ZHI_WUXING[p.zhi] || ganWx;
              return h(
                'div',
                { class: 'pillar' },
                h('div', { class: 'pillar-label' }, p.label),
                ss.god && ss.god !== '日主'
                  ? h('div', { style: `font-size:10.5px;color:${WUXING_COLORS[ganWx] || '#8a8a8a'}` }, ss.god)
                  : h('div', { style: 'font-size:10.5px;color:#b5762a;font-weight:600' }, '日主'),
                h('div', { class: 'pillar-char', style: `color:${WUXING_COLORS[ganWx]}` }, p.gan),
                h('div', { class: 'pillar-char', style: `color:${WUXING_COLORS[zhiWx] || '#5c5852'};opacity:.85` }, p.zhi),
                ss.zhiGod && ss.zhiGod !== '日主' ? h('div', { class: 'muted', style: 'font-size:10px' }, `藏 ${ss.zhiGod}`) : null
              );
            })
          )
        )
      : null,

    h(
      'div',
      { class: 'bs-tabs' },
      ...[
        { k: 'chart', l: '我的盘', icon: '☯' },
        { k: 'self', l: '自评', icon: '✎' },
        { k: 'qa', l: '问答记录', icon: '◌' }
      ].map((t) =>
        h(
          'button',
          {
            class: 'bs-tab' + (bz.view === t.k ? ' on' : ''),
            onclick: () => {
              bz.view = t.k;
              render();
            }
          },
          h('span', { class: 'ic' }, t.icon),
          t.l,
          t.k === 'qa' && bz.qa.length ? h('span', { class: 'chip-n' }, String(bz.qa.length)) : null
        )
      )
    ),

    !c && bz.view !== 'qa'
      ? h(
          'div',
          { class: 'card' },
          h('h3', { class: 'card-title' }, '还差一份生辰'),
          h('p', { class: 'muted', style: 'margin:0 0 14px' }, '填了出生年月日时，才能排出你的盘。'),
          h('button', { class: 'btn btn-accent', onclick: () => setState({ view: 'fortune' }) }, '去填生辰')
        )
      : null,

    c && bz.view === 'chart' ? chartPanel(c, b) : null,
    c && bz.view === 'self' ? selfPanel(c) : null,
    bz.view === 'qa' ? qaPanel(c) : null,

    /* 生辰编辑面板：从运势页提升到全局可复用，改完两个页面同步更新 */
    birthEditor()
  );
}

/* ---------------- 我的盘 ---------------- */

/* ---------------- 从圈子页搬来的三块 ----------------

   原来放在「圈子」页的本人卡里，用户明确说：朋友圈不放这个，
   这个信息属于八字。整体搬到这里，内容没动：

     1. 流年 —— 今年这根柱子相对日主的十神，以及它意味着什么；
     2. 十神关系 —— 盘里各十神的分布、相邻天干生克、组合含义；
     3. 用神 / 喜神 / 忌神 —— 扶抑法取用，附颜色方位建议。 */

const SHEN_GROUP = {
  比肩: '比劫', 劫财: '比劫', 食神: '食伤', 伤官: '食伤',
  偏财: '财星', 正财: '财星', 七杀: '官杀', 正官: '官杀',
  偏印: '印星', 正印: '印星', 日主: null
};
const SHEN_MEAN = {
  比肩: '跟我同类：主见、朋友、竞争，也主破费分利',
  劫财: '同我相争：合伙、开销大，慷慨也冲动',
  食神: '我顺生出的：表达、口福、才华，安稳的享受',
  伤官: '我逆生出的：聪明外露、创新、不服管，也易惹口舌',
  偏财: '我管住的活钱：投资、应酬、意外之财',
  正财: '我管住的稳钱：工资、积蓄、踏实经营',
  七杀: '克我的偏力：压力、竞争、魄力，也主突发事件',
  正官: '克我的正力：规则、职责、名声、自我约束',
  偏印: '生我的偏力：直觉、另类学识、想得多',
  正印: '生我的正力：学习、长辈、贵人庇护'
};
const GROUP_LINE = {
  比劫: { yes: '比劫成群：自我强、朋友多，但钱守不太住', no: '盘里无比劫：做决定不太靠同伴，习惯自己拿主意' },
  食伤: { yes: '食伤有根：表达和才华是你对外的出口', no: '盘里无食伤：输出偏少，想法多、说出来少' },
  财星: { yes: '财星在盘：钱上的事分量重，务实的路子走得通', no: '盘里无财星：钱是工具不是目标，理财意识要刻意培养' },
  官杀: { yes: '官杀在盘：责任与压力推着你走，也给你位置', no: '盘里无官杀：不爱被管，规则感靠自觉' },
  印星: { yes: '印星在盘：有人护你，也爱学东西', no: '盘里无印星：靠山偏少，事多自己扛' }
};
const SHEN_REL = [
  ['财星', '官杀', '财能生官：钱和资源能换来位置与话语权'],
  ['官杀', '印星', '官能生印：压力能转化为资历与庇护'],
  ['印星', '比劫', '印能生身：学识和靠山喂养了自我'],
  ['比劫', '食伤', '身能生食：自我输出为表达与作品'],
  ['食伤', '财星', '食能生财：才华和表达能直接变现'],
  ['食伤', '官杀', '食伤制杀：敢顶撞权威，也敢正面扛压力'],
  ['比劫', '财星', '比劫夺财：朋友合伙处容易在钱上有摩擦']
];

  function shishenRelations(bz) {
    const ss = bz.shishen || [];
    const counts = {};
    for (const s of ss) {
      for (const g of [s.god, s.zhiGod]) {
        const grp = SHEN_GROUP[g];
        if (grp) counts[grp] = (counts[grp] || 0) + 1;
      }
    }
    const lines = [];
    for (const g of ['比劫', '食伤', '财星', '官杀', '印星']) {
      const info = GROUP_LINE[g];
      if (counts[g]) lines.push(`· ${g} ×${counts[g]}：${info.yes}`);
      else lines.push(`· ${g}：${info.no}`);
    }
    /* 相邻天干之间的生克（年→月→日→时） */
    const ganList = bz.pillars.map((p) => ({ gan: p.gan, wx: GAN_WUXING[p.gan] }));
    const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
    const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
    const flows = [];
    for (let i = 0; i < ganList.length - 1; i += 1) {
      const a = ganList[i];
      const b = ganList[i + 1];
      if (!a.wx || !b.wx) continue;
      if (SHENG[a.wx] === b.wx) flows.push(`· ${a.gan}(${a.wx}) 生 ${b.gan}(${b.wx})`);
      else if (KE[a.wx] === b.wx) flows.push(`· ${a.gan}(${a.wx}) 克 ${b.gan}(${b.wx})`);
      else if (SHENG[b.wx] === a.wx) flows.push(`· ${b.gan}(${b.wx}) 生 ${a.gan}(${a.wx})`);
      else if (KE[b.wx] === a.wx) flows.push(`· ${b.gan}(${b.wx}) 克 ${a.gan}(${a.wx})`);
    }
    /* 十神组合之间的关系 */
    const grps = Object.keys(counts).filter((g) => counts[g] > 0);
    const relHits = SHEN_REL.filter(([a, b]) => grps.includes(a) && grps.includes(b)).map(([, , t]) => `· ${t}`);
    return { lines, flows, relHits };
  }

  /* 流年块：今年年柱相对日主的十神 */
  function yearBlockOf(bz) {
    const dGan = bz.dayMaster;
    const today = dailyFortune(new Date());
    const yGz = String(today.yearGz || '');
    const yGan = yGz[0] || '';
    const yZhi = yGz[1] || '';
    const yGanGod = yGan ? tenGod(dGan, yGan) : '';
    /* 地支不能直接喂给 tenGod（它只认天干），要取藏干本气 */
    const yZhiMain = (ZHI_CANG[yZhi] || [])[0] || '';
    const yZhiGod = yZhiMain ? tenGod(dGan, yZhiMain) : '';
    const wxOf = (ch) => GAN_WUXING[ch] || ZHI_WUXING[ch] || '';
    if (!yGz) return null;
    return h(
      'div',
      { style: 'margin-top:14px;padding:10px 12px;border-radius:10px;background:var(--hover)' },
      h(
        'div',
        { style: 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap' },
        h('span', { style: 'font-weight:600;font-size:13px' }, `当年 ${today.year || ''} ${yGz}`),
        h('span', { style: `font-size:16px;font-weight:600;color:${WUXING_COLORS[wxOf(yGan)] || '#5c5852'}` }, yGan),
        h('span', { class: 'muted', style: 'font-size:11px' }, yGanGod ? `${yGanGod}：${SHEN_MEAN[yGanGod] || ''}` : ''),
        h('span', { style: `font-size:16px;font-weight:600;color:${WUXING_COLORS[wxOf(yZhi)] || '#5c5852'}` }, yZhi),
        h('span', { class: 'muted', style: 'font-size:11px' }, yZhiGod ? `${yZhiGod}：${SHEN_MEAN[yZhiGod] || ''}` : '')
      ),
      h('p', { class: 'muted', style: 'margin:6px 0 0;font-size:11.5px;line-height:1.7' },
        `流年${yGan}（${wxOf(yGan)}）是${yGanGod || '—'}——今年外部的主题；流年${yZhi}（${wxOf(yZhi)}）藏${yZhiGod}——落到具体日子里的滋味。和你日主${dGan}放在一起看，就是「今年什么在生你、什么在克你」。`)
    );
  }

  /* 十神关系块 */
  function relationBlockOf(bz) {
    let rel = null;
    try {
      rel = shishenRelations(bz);
    } catch (e) {
      return null;
    }
    return h(
      'div',
      { style: 'margin-top:14px' },
      h('div', { style: 'font-weight:600;font-size:12.5px;margin-bottom:6px' }, '八字里各十神的关系'),
      ...rel.lines.map((t) => h('div', { style: 'font-size:12px;line-height:1.8;color:var(--ink-2)' }, t)),
      rel.flows.length
        ? h(
            'div',
            { style: 'margin-top:8px' },
            h('div', { class: 'muted', style: 'font-size:11.5px;margin-bottom:4px' }, '天干之间的生克（相邻两柱）'),
            ...rel.flows.map((t) => h('div', { style: 'font-size:12px;line-height:1.8;color:var(--ink-2)' }, t))
          )
        : null,
      rel.relHits.length
        ? h(
            'div',
            { style: 'margin-top:8px' },
            h('div', { class: 'muted', style: 'font-size:11.5px;margin-bottom:4px' }, '组合起来看'),
            ...rel.relHits.map((t) => h('div', { style: 'font-size:12px;line-height:1.8;color:var(--ink-2)' }, t))
          )
        : null
    );
  }



  /* 用神 / 喜神 / 忌神块（扶抑法，同运势页的算法） */
  function yongshenBlockOf(chart) {
    let fg = null;
    try {
      fg = favorableGods(chart);
    } catch (e) {
      return null;
    }
    if (!fg || !fg.useful || !fg.useful.length) return null;

    const chip = (u, cls) =>
      h(
        'span',
        { class: 'chip ' + cls, style: `border-color:${WUXING_COLORS[u.wx]};color:${WUXING_COLORS[u.wx]}` },
        u.role && u.role !== u.wx ? `${u.wx}·${u.role}` : u.wx
      );

    return h(
      'div',
      { style: 'margin-top:14px' },
      h(
        'div',
        { class: 'pc-line' },
        h('span', { class: 'pc-k' }, '日主'),
        h('span', { class: 'pc-v' }, `${fg.dayMaster}（${fg.dayMasterWuxing}）· ${fg.verdict}`)
      ),
      h(
        'div',
        { class: 'pc-line' },
        h('span', { class: 'pc-k' }, '用神'),
        h('span', { class: 'pc-v' }, ...fg.useful.map((u) => chip(u, 'chip-good')))
      ),
      fg.favorable.length
        ? h(
            'div',
            { class: 'pc-line' },
            h('span', { class: 'pc-k' }, '喜神'),
            h('span', { class: 'pc-v' }, ...fg.favorable.map((u) => chip(u, 'chip-good')))
          )
        : null,
      h(
        'div',
        { class: 'pc-line' },
        h('span', { class: 'pc-k' }, '忌神'),
        h('span', { class: 'pc-v' }, ...fg.avoid.map((u) => chip(u, 'chip-bad')))
      ),
      fg.reasoning && fg.reasoning.length
        ? h(
            'div',
            { style: 'margin-top:8px' },
            ...fg.reasoning.map((t) =>
              h('div', { style: 'font-size:12px;line-height:1.8;color:var(--ink-2)' }, `· ${t}`)
            )
          )
        : null,
      h(
        'p',
        { class: 'muted', style: 'margin:10px 0 0;font-size:12.5px;line-height:1.7' },
        `用色 ${fg.advice.colors.join('、') || '—'}；方位 ${fg.advice.dirs.join('、') || '—'}。`
      )
    );
  }

/* ---------------- 八字盘 ---------------- */

function chartPanel(c, b) {
  const prof = daymasterProfile(c.dayMaster);
  const today = dailyFortune(new Date());
const rel = relationToDayMaster(c.dayMasterWuxing, today.dayWuxing);
const con = consistency(c, { traits: bz.traits });
const scored = scoreDimensions(bz.answers);
const filledAll = scored.reduce((a, s) => a + s.filled, 0);
const totalQ = SELF_DIMENSIONS.reduce((a, d) => a + d.items.length, 0);

return h(
  'div',
  {},
  /* 日主 */
  h(
    'div',
    { class: 'bs-hero' },
    h(
      'div',
      { class: 'bs-master' },
      h('div', { class: 'bs-master-gan', style: `color:${WUXING_COLORS[c.dayMasterWuxing]}` }, c.dayMaster),
      h('div', { class: 'bs-master-meta' },
        h('div', { class: 'bs-master-title' }, prof ? prof.nature : ''),
        h('div', { class: 'muted' }, `日主${c.dayMasterWuxing} · 属${c.animal}`)
      )
    ),
    h(
      'div',
      { class: 'bs-gist' },
      prof ? h('p', { style: 'margin:0;font-size:13px;line-height:1.75' }, prof.gist) : null,
      h(
        'div',
        { class: 'bs-today' },
        h('span', { class: 'muted' }, `今日 ${today.dayGz}（${today.dayWuxing}）`),
        h('span', { class: 'bs-rel' }, rel.text)
      )
    )
  ),

  /* 四柱 */
  h(
    'div',
    { class: 'card' },
    h('div', { class: 'row-between' },
      h('h3', { class: 'card-title', style: 'margin:0' }, '四柱'),
      h('span', { class: 'muted', style: 'font-size:11.5px' }, c.usedTrueSolar ? '真太阳时 · 精确节气' : '未做真太阳时校正')
    ),
    h(
      'div',
      { class: 'pillar-row', style: 'margin-top:14px' },
      ...c.pillars.map((p, i) => {
        const ss = (c.shishen || [])[i] || {};
        const ganWx = GAN_WUXING[p.gan];
        const zhiWx = ZHI_WUXING[p.zhi] || ganWx;
        return h(
          'div',
          { class: 'pillar' },
          h('div', { class: 'pillar-label' }, p.label),
          ss.god && ss.god !== '日主'
            ? h('div', { style: `font-size:10.5px;color:${WUXING_COLORS[ganWx] || '#8a8a8a'}` }, ss.god)
            : h('div', { style: 'font-size:10.5px;color:#b5762a;font-weight:600' }, '日主'),
          h('div', { class: 'pillar-char', style: `color:${WUXING_COLORS[ganWx]}` }, p.gan),
          h('div', { class: 'pillar-char', style: `color:${WUXING_COLORS[zhiWx] || '#5c5852'};opacity:.85` }, p.zhi),
          ss.zhiGod && ss.zhiGod !== '日主'
            ? h('div', { class: 'muted', style: 'font-size:10px' }, `藏 ${ss.zhiGod}`)
            : null
        );
      })
    ),
    /* 排盘依据：让人能自己核对 */
    h(
      'div',
      {
        style:
          'margin-top:16px;padding:12px 14px;border-radius:10px;background:var(--hover);font-size:12.5px;line-height:1.95'
      },
      h('div', { style: 'font-weight:600;margin-bottom:6px' }, '排盘依据'),
      c.usedTrueSolar
        ? h(
            'div',
            {},
            h(
              'div',
              {},
              '真太阳时 ',
              h(
                'span',
                { style: 'font-weight:600' },
                `${String(Math.floor(c.trueSolarHour)).padStart(2, '0')}:${String(Math.round((c.trueSolarHour % 1) * 60)).padStart(2, '0')}`
              ),
              `（北京钟点校正 ${c.solarOffsetMin >= 0 ? '+' : ''}${c.solarOffsetMin} 分）`
            ),
            h(
              'div',
              { class: 'muted' },
              `　= 经度项 ${c.lonPartMin >= 0 ? '+' : ''}${c.lonPartMin} 分（东经 ${c.lon}°）`,
              ` + 均时差 ${c.eotPartMin >= 0 ? '+' : ''}${c.eotPartMin} 分`,
              c.dstPartMin ? ` − 夏令时 ${Math.abs(c.dstPartMin)} 分` : ''
            ),
            c.place ? h('div', { class: 'muted' }, `　出生地：${c.place}`) : null,
            c.solarDayShift ? h('div', { style: 'color:#b5762a' }, `　真太阳时跨日 ${c.solarDayShift > 0 ? '进一天' : '退一天'}，日柱已相应调整`) : null
          )
        : h('div', { style: 'color:#b5762a' }, '未设置出生地经度，时柱按北京钟点直接切分，西部城市会偏 1–2 个时辰。'),
      h('div', { style: 'margin-top:6px' }, `年柱以立春为界：上一节 ${c.jiePrev ? c.jiePrev.name + ' ' + c.jiePrev.at : '—'}`),
      h('div', { class: 'muted' }, `月柱以十二节为界：下一节 ${c.jieNext ? c.jieNext.name + ' ' + c.jieNext.at : '—'}`),
      c.nearJie
        ? h(
            'div',
            { style: 'color:#b5762a;margin-top:4px' },
            `距交节只有 ${c.daysToNextJie} 天，月柱处于临界，出生时刻差几分钟就可能换一柱，请再核对。`
          )
        : null
    ),

    /* 五行条 */
    h(
      'div',
      { style: 'margin-top:18px' },
      h('div', { class: 'muted', style: 'font-size:11.5px;margin-bottom:8px' }, '五行分布'),
      h(
        'div',
        { class: 'wuxing-bar' },
        ...Object.entries(c.wuxing)
          .filter(([, v]) => v > 0)
          .map(([k, v]) =>
            h(
              'div',
              { class: 'wuxing-seg', style: `flex:${v};background:${WUXING_COLORS[k]}`, title: `${k} ${v}` },
              h('span', {}, k)
            )
          )
      ),
        h('p', { class: 'muted', style: 'margin:8px 0 0;font-size:12px' }, `${c.strongest[0]}最旺，${c.weakest[0]}最弱`)
      ),

      /* ---- 以下三块原在「圈子」页的本人卡里，用户要求搬到八字页 ---- */
      yearBlockOf(c),
      relationBlockOf(c),
      h(
        'div',
        { style: 'margin-top:20px;padding-top:16px;border-top:1px solid var(--line)' },
        h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:2px' }, '用神 · 喜神 · 忌神'),
        h('p', { class: 'muted', style: 'margin:0;font-size:11.5px;line-height:1.7' }, '扶抑法取用：先看得令、得地，再看扶身之力占几成。'),
        yongshenBlockOf(c)
      )
    ),

  /* 五行倾向 + 自评入口 */
  h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'row-between' },
      h('h3', { class: 'card-title', style: 'margin:0' }, '这些说法像你吗'),
      h('span', { class: 'muted', style: 'font-size:11.5px' }, `已自评 ${filledAll}/${totalQ}`)
    ),
    h('p', { class: 'muted', style: 'margin:6px 0 14px;font-size:12px;line-height:1.7' },
      '命理给的是抽象属性。下面把最旺的五行拆成几句能自己验证的话——你觉得像就选「像」，不像就选「不像」。你的判断优先。'),
    ...['strongest', 'weakest'].map((which) => {
      const el = c[which][0];
      const t = ELEMENT_TRAITS[el];
      if (!t) return null;
      const cur = bz.traits[el];
      return h(
        'div',
        { class: 'bs-trait' },
        h(
          'div',
          { class: 'bs-trait-head' },
          h('span', { class: 'bs-trait-el', style: `background:${WUXING_COLORS[el]}18;color:${WUXING_COLORS[el]}` },
            `${el}（${which === 'strongest' ? '最旺' : '最弱'}）· ${t.gist}`),
          h('div', { style: 'flex:1' }),
          h('div', { class: 'verdict-group' },
            ...[
              { v: 1, l: '像' },
              { v: 0, l: '说不准' },
              { v: -1, l: '不像' }
            ].map((o) =>
              h(
                'button',
                {
                  class: 'verdict' + (cur === o.v ? ' on' : '') + (o.v === 1 ? ' yes' : o.v === -1 ? ' no' : ''),
                  onclick: () => {
                    bz.traits[el] = cur === o.v ? undefined : o.v;
                    if (bz.traits[el] === undefined) delete bz.traits[el];
                    persist();
                    render();
                  }
                },
                o.l
              )
            )
          )
        ),
        h(
          'div',
          { class: 'bs-trait-say' },
          ...t.say.map((s) => h('div', { class: 'bs-say-line' }, h('span', { class: 'bs-say-dot' }), s))
        )
      );
    }),

    con
      ? h('p', { class: 'bs-consist ' + (con.strongVerdict === -1 ? 'dissent' : con.agree ? 'agree' : 'neutral') }, con.text)
      : null,

    h(
      'button',
      {
        class: 'btn btn-accent',
        style: 'margin-top:16px',
        onclick: () => {
          bz.view = 'self';
          render();
        }
      },
      filledAll ? `继续自评（${filledAll}/${totalQ}）` : '开始完整自评'
    )
  )
);
}

/* ---------------- 自评 ---------------- */

function selfPanel(c) {
const scored = scoreDimensions(bz.answers);
const totalQ = SELF_DIMENSIONS.reduce((a, d) => a + d.items.length, 0);
const filled = scored.reduce((a, s) => a + s.filled, 0);

return h(
  'div',
  {},
  h(
    'div',
    { class: 'bs-self-head' },
    h('div', {}, h('h3', { style: 'margin:0;font-size:14px' }, '六组说法，自己判断'),
      h('p', { class: 'muted', style: 'margin:5px 0 0;font-size:12px' }, '没有对错，只用来形成你的自评画像。拿不准就选「说不准」。')),
    h('div', { class: 'bs-prog' },
      h('div', { class: 'bs-prog-bar' }, h('div', { class: 'bs-prog-fill', style: `width:${totalQ ? (filled / totalQ) * 100 : 0}%` })),
      h('span', { class: 'muted', style: 'font-size:11px' }, `${filled}/${totalQ}`)
    )
  ),

  ...SELF_DIMENSIONS.map((d) => {
    const s = scored.find((x) => x.k === d.k);
    return h(
      'div',
      { class: 'card bs-dim' },
      h(
        'div',
        { class: 'bs-dim-head' },
        h('span', { class: 'bs-dim-name', style: `color:${d.color}` }, d.label),
        h('div', { style: 'flex:1' }),
        s.rate != null ? h('span', { class: 'bs-dim-rate' }, `认同 ${Math.round(s.rate * 100)}%`) : h('span', { class: 'muted', style: 'font-size:11px' }, '未作答')
      ),
      ...d.items.map((text, i) => {
        const key = `${d.k}:${i}`;
        const v = bz.answers[key];
        return h(
          'div',
          { class: 'bs-item' },
          h('div', { class: 'bs-item-q' }, text),
          h(
            'div',
            { class: 'verdict-group' },
            ...[
              { v: 1, l: '像' },
              { v: 0, l: '说不准' },
              { v: -1, l: '不像' }
            ].map((o) =>
              h(
                'button',
                {
                  class: 'verdict' + (v === o.v ? ' on' : '') + (o.v === 1 ? ' yes' : o.v === -1 ? ' no' : ''),
                  onclick: () => {
                    bz.answers[key] = v === o.v ? undefined : o.v;
                    if (bz.answers[key] === undefined) delete bz.answers[key];
                    persist();
                    render();
                  }
                },
                o.l
              )
            )
          )
        );
      })
    );
  }),

  /* 画像 */
  filled
    ? h(
        'div',
        { class: 'card' },
        h('h3', { class: 'card-title' }, '你的自评画像'),
        ...scored
          .filter((s) => s.rate != null)
          .map((s) =>
            h(
              'div',
              { class: 'bs-score-row' },
              h('span', { class: 'bs-score-name' }, s.label),
              h('div', { class: 'bs-score-track' },
                h('div', { class: 'bs-score-fill', style: `width:${s.rate * 100}%;background:${s.color}` })),
              h('span', { class: 'bs-score-n' }, `${Math.round(s.rate * 100)}%`)
            )
          ),
        h('p', { class: 'hint', style: 'margin-top:12px' },
          '百分比是「你认同的条数 ÷ 你明确表态的条数」。选「说不准」的不计入，所以填得越明确，这个数字越有意义。')
      )
    : null,

  h(
    'div',
    { class: 'row', style: 'margin-top:8px' },
    h('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: async () => {
        if (!(await confirmAsk('清空全部自评答案？'))) return;
        bz.answers = {};
        bz.traits = {};
        persist();
        render();
        toast('已清空');
      }
    }, '清空自评'),
    h('div', { style: 'flex:1' }),
    h('button', {
      class: 'btn btn-accent btn-sm',
      onclick: () => {
        bz.view = 'chart';
        render();
        toast('已保存');
      }
    }, '保存并返回')
  )
);
}

function persist() {
bz.self = { answers: bz.answers, traits: bz.traits, updatedAt: new Date().toISOString() };
saveSelf(bz.self);
}

/* ---------------- 问答 ---------------- */

const SUGGEST = [
'我这个日主在压力大的时候容易怎样？',
'今年适合换工作吗？从八字看要注意什么？',
'为什么我总在花钱上反复纠结？',
'我和某类人相处容易累，能从八字说说什么吗？'
];

function systemPrompt(c) {
const prof = daymasterProfile(c.dayMaster);
const pillars = c.pillars.map((p) => `${p.label}${p.gan}${p.zhi}`).join(' ');
const scored = scoreDimensions(bz.answers);
const selfLines = scored
  .filter((s) => s.rate != null)
  .map((s) => `${s.label}认同度 ${Math.round(s.rate * 100)}%`)
  .join('；');

return `你是帮助用户「自评」八字与性格的助手。用户自己排了盘，也做了性格自评，现在向你提问。

用户命盘：${pillars}。日主 ${c.dayMaster}（${c.dayMasterWuxing}），${prof ? prof.nature + '，' + prof.gist : ''}。
五行分布：${Object.entries(c.wuxing).map(([k, v]) => k + v).join('、')}；${c.strongest[0]}最旺，${c.weakest[0]}最弱。
用户自评结果：${selfLines || '尚未完成自评'}。

回答要求：
1. 用中文，语气像懂行的朋友，不像算命先生。
2. 只把命理当作提供「思考角度」的工具，不要断言命运、健康、婚姻、财运的必然结果，不要说「命中注定」「一定会」。
3. 尽量结合用户的自评结果来讲。如果命理的说法和他的自评矛盾，明确说「以你的实际感受为准」。
4. 涉及健康、重大决策时，提醒这只是一种视角，不能替代医生或专业判断。
5. 简洁，控制在 300 字以内，说人话，少用术语；必须用术语时顺带解释一句。`;
}

function qaPanel(c) {
return h(
  'div',
  {},
  h(
    'div',
    { class: 'bs-self-head' },
    h('div', {},
      h('h3', { style: 'margin:0;font-size:14px' }, '问它，然后记下来'),
      h('p', { class: 'muted', style: 'margin:5px 0 0;font-size:12px' }, '每次问答都会存进记录，之后可以回看自己当时的想法'))
  ),

  /* 提问框 */
  h(
    'div',
    { class: 'card bs-ask' },
    h('textarea', {
      class: 'input',
      style: 'min-height:76px;resize:vertical;line-height:1.65',
      placeholder: '想问什么？比如：我最近总是拖，跟我的盘有关系吗？',
      value: bz.q,
      oninput: (ev) => {
        bz.q = ev.target.value;
      },
      onkeydown: (ev) => {
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault();
          ask();
        }
      }
    }),
    h(
      'div',
      { class: 'row', style: 'margin-top:10px;align-items:center' },
      h('span', { class: 'muted', style: 'font-size:11px' }, 'Ctrl / ⌘ + Enter 发送'),
      h('div', { style: 'flex:1' }),
      bz.asking
        ? h('button', { class: 'btn btn-sm', onclick: () => { bz.abort?.abort(); } }, '停止')
        : h('button', { class: 'btn btn-sm btn-accent', onclick: ask }, '提问')
    ),
    !bz.qa.length
      ? h(
          'div',
          { class: 'suggests', style: 'margin-top:12px;padding-top:12px;border-top:1px solid #f2f2f5' },
          ...SUGGEST.map((s) => h('button', { class: 'suggest', onclick: () => { bz.q = s; render(); } }, s))
        )
      : null
  ),

  bz.err ? h('div', { class: 'err', style: 'margin-bottom:12px' }, bz.err) : null,

  bz.qa.length
    ? h(
        'div',
        {},
        h('div', { class: 'section-label' }, `记录（${bz.qa.length}）`),
        ...bz.qa.map((row) => qaItem(row))
      )
    : bz.qaLoaded
      ? h('div', { class: 'empty' }, h('div', { class: 'big' }, '◌'), h('p', {}, '还没有问答记录。上面问第一个问题吧。'))
      : null
);
}

function qaItem(row) {
const when = row.created_at ? new Date(row.created_at) : null;
const stamp = when ? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}` : row.day_key;
const isDraft = row.id === 'draft';
return h(
  'div',
  { class: 'bs-qa' + (isDraft ? ' drafting' : '') },
  h(
    'div',
    { class: 'bs-qa-head' },
    h('span', { class: 'bs-qa-date' }, stamp || ''),
    row.day_gz ? h('span', { class: 'bs-qa-gz' }, `${row.day_gz}日`) : null,
    h('div', { style: 'flex:1' }),
    h('button', {
      class: 'link-btn',
      onclick: async () => {
        const note = await askText('给这条加个备注（留空则清除）：', row.note || '');
        if (note === null) return;
        try {
          await updateBaziNote(row.id, note || null);
          row.note = note || null;
          render();
          toast('已保存备注');
        } catch (e) {
          toast('保存失败：' + (e.message || e), 'err');
        }
      }
    }, '备注'),
    h('button', {
      class: 'link-btn danger',
      onclick: async () => {
        if (!(await confirmAsk('删除这条记录？'))) return;
        try {
          await deleteBaziQA(row.id);
          bz.qa = bz.qa.filter((x) => x.id !== row.id);
          render();
          toast('已删除');
        } catch (e) {
          toast('删除失败：' + (e.message || e), 'err');
        }
      }
    }, '删除')
  ),
  h('div', { class: 'bs-qa-q' }, row.question),
  h('div', { class: 'bs-qa-a' }, row.answer || (isDraft ? '正在回答…' : '')),
  row.note ? h('div', { class: 'bs-qa-note' }, '我的想法：' + row.note) : null,
  isDraft
    ? null
    : h(
        'div',
        { class: 'bs-qa-act' },
        h('button', {
          class: 'link-btn',
          onclick: () => {
            bz.q = row.question;
            render();
            toast('已填回提问框，可改一下再问');
          }
        }, '再问一次')
      )
);
}

/* 提问：流式回答，结束后落库 */
async function ask() {
const q = String(bz.q || '').trim();
if (!q || bz.asking) return;
const c = computed();
if (!c) {
  toast('先填生辰八字', 'err');
  return;
  }

  bz.asking = true;
  bz.err = '';
  bz.q = '';
  const draft = { id: 'draft', question: q, answer: '', created_at: new Date().toISOString(), day_key: todayStr(), day_gz: dailyFortune(new Date()).dayGz };
  bz.qa = [draft, ...bz.qa];
  render();

  bz.abort = new AbortController();
  let acc = '';
  try {
    await ensureModel();
    await streamWithSystem({
      system: systemPrompt(c),
      messages: [{ role: 'user', content: q }],
      signal: bz.abort.signal,
      onDelta: (d) => {
        acc += d;
        const el = document.querySelector('.bs-qa.drafting .bs-qa-a');
        if (el) el.textContent = acc;
      }
    });
    /* 落库；失败也不丢内容，只是这轮不记 */
    await saveBaziQA({ question: q, answer: acc, day_key: draft.day_key, day_gz: draft.day_gz });
    bz.qa = await listBaziQA();
  } catch (e) {
    if (e?.name === 'AbortError') {
      bz.err = '已停止。这轮回答没有记录。';
    } else {
      bz.err = '提问失败：' + (e.message || e);
    }
    if (acc) draft.answer = acc;
  } finally {
    bz.asking = false;
    bz.abort = null;
    render();
  }
}
