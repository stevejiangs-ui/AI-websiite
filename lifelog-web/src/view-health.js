/* 身体健康：每天 30 秒打卡（心情、精力、睡眠、体重、运动、步数、喝水），
   看近 30 天趋势，让 AI 结合数据给建议。 */
import { h, render, toast, state, todayStr } from './store.js';
import { listHealth, saveHealthLog, MOOD_SCALE, errText, isMissingTable } from './cloud.js';
import { askAI } from './ai.js';
import { setupCard } from './view-setup.js';

let hs = { loaded: false, logs: [], missing: false, form: null, busy: false, ai: '', aiBusy: false };

function blankForm(date) {
  const hit = hs.logs.find((r) => String(r.log_date).slice(0, 10) === date);
  return {
    log_date: date,
    mood: hit?.mood ?? '',
    energy: hit?.energy ?? '',
    sleep_hours: hit?.sleep_hours ?? '',
    weight_kg: hit?.weight_kg ?? lastValue('weight_kg') ?? '',
    exercise_min: hit?.exercise_min ?? '',
    steps: hit?.steps ?? '',
    water_cups: hit?.water_cups ?? '',
    note: hit?.note ?? '',
    existed: !!hit
  };
}

function lastValue(k) {
  const r = hs.logs.find((x) => x[k] != null && x[k] !== '');
  return r ? r[k] : null;
}

export async function loadHealth() {
  try {
    hs.logs = (await listHealth({ days: 120 })) || [];
    hs.missing = false;
  } catch (e) {
    if (isMissingTable(e)) hs.missing = true;
    else throw e;
  }
  hs.loaded = true;
  hs.form = blankForm(hs.form?.log_date || todayStr());
  render();
}

/** 首页用：今天打卡了没、近 7 天概况 */
export function healthSummary() {
  const logs = hs.logs || [];
  const t = todayStr();
  const today = logs.find((r) => String(r.log_date).slice(0, 10) === t) || null;
  const last7 = logs.filter((r) => daysAgo(r.log_date) < 7);
  const avg = (k) => {
    const v = last7.map((r) => Number(r[k])).filter((n) => Number.isFinite(n) && n > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return { loaded: hs.loaded, missing: hs.missing, today, sleep: avg('sleep_hours'), mood: avg('mood'), exercise: last7.reduce((a, r) => a + (Number(r.exercise_min) || 0), 0), weight: lastValue('weight_kg') };
}

export function healthLogs() {
  return hs.logs || [];
}

function daysAgo(d) {
  const t = new Date(todayStr() + 'T00:00:00');
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Math.round((t - x) / 86400000);
}

async function save() {
  if (hs.busy) return;
  const f = hs.form;
  hs.busy = true;
  render();
  try {
    await saveHealthLog(f);
    toast(f.existed ? '已更新' : '打卡成功');
    await loadHealth();
  } catch (e) {
    toast('保存失败：' + errText(e), 'err');
  }
  hs.busy = false;
  render();
}

function setF(k, v, rerender = false) {
  hs.form[k] = v;
  if (rerender) render();
}

function numField(id, label, key, unit, step = '1', ph = '') {
  return h(
    'div',
    { class: 'hl-field' },
    h('label', { for: id }, label, unit ? h('span', { class: 'muted' }, ` ${unit}`) : null),
    h('input', {
      class: 'input',
      id,
      type: 'number',
      inputmode: 'decimal',
      step,
      placeholder: ph,
      value: hs.form[key] ?? '',
      oninput: (ev) => setF(key, ev.target.value)
    })
  );
}

function scale(label, key, items) {
  return h(
    'div',
    { class: 'hl-scale' },
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, label),
    h(
      'div',
      { class: 'hl-scale-row' },
      ...items.map((it) =>
        h(
          'button',
          {
            class: 'hl-pick' + (Number(hs.form[key]) === it.v ? ' on' : ''),
            title: it.label,
            onclick: () => setF(key, Number(hs.form[key]) === it.v ? '' : it.v, true)
          },
          h('span', { class: 'em' }, it.em),
          h('span', {}, it.label)
        )
      )
    )
  );
}

const ENERGY = [
  { v: 1, label: '没劲', em: '🪫' },
  { v: 2, label: '偏累', em: '😮‍💨' },
  { v: 3, label: '正常', em: '🙂' },
  { v: 4, label: '有劲', em: '💪' },
  { v: 5, label: '满格', em: '⚡' }
];

function checkinCard() {
  const f = hs.form;
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'row-between', style: 'margin-bottom:12px;gap:10px;flex-wrap:wrap' },
      h('h3', { class: 'card-title', style: 'margin:0' }, f.log_date === todayStr() ? '今天打卡' : '补打卡'),
      h('input', {
        class: 'input',
        id: 'hl-date',
        type: 'date',
        style: 'width:auto;height:34px',
        value: f.log_date,
        max: todayStr(),
        onchange: (ev) => {
          hs.form = blankForm(ev.target.value || todayStr());
          render();
        }
      })
    ),
    scale('心情', 'mood', MOOD_SCALE),
    scale('精力', 'energy', ENERGY),
    h(
      'div',
      { class: 'hl-grid' },
      numField('hl-sleep', '睡眠', 'sleep_hours', '小时', '0.5', '7.5'),
      numField('hl-weight', '体重', 'weight_kg', 'kg', '0.1', '70'),
      numField('hl-ex', '运动', 'exercise_min', '分钟', '5', '30'),
      numField('hl-steps', '步数', 'steps', '步', '100', '8000'),
      numField('hl-water', '喝水', 'water_cups', '杯', '1', '8')
    ),
    h('textarea', {
      class: 'input',
      id: 'hl-note',
      rows: 2,
      style: 'margin-top:10px;resize:vertical',
      placeholder: '身体感觉、吃了什么、哪里不舒服…（选填）',
      value: f.note,
      oninput: (ev) => setF('note', ev.target.value)
    }),
    h(
      'button',
      { class: 'btn btn-accent btn-block', style: 'margin-top:12px', disabled: hs.busy, onclick: save },
      hs.busy ? h('span', { class: 'spinner' }) : f.existed ? '更新这天的打卡' : '打卡'
    )
  );
}

/* 简单折线：最近 30 天，缺的日子断开 */
function spark(key, label, unit, color, fmt = (v) => v) {
  const days = 30;
  const pts = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = hs.logs.find((x) => String(x.log_date).slice(0, 10) === ds);
    const v = r && r[key] != null && r[key] !== '' ? Number(r[key]) : null;
    pts.push(Number.isFinite(v) ? v : null);
  }
  const vals = pts.filter((v) => v != null);
  const W = 300;
  const H = 70;
  if (vals.length < 2) {
    return h('div', { class: 'hl-spark' }, h('div', { class: 'hl-spark-head' }, h('b', {}, label), h('span', { class: 'muted' }, vals.length ? `${fmt(vals[0])} ${unit}` : '—')), h('div', { class: 'muted', style: 'font-size:12px;padding:18px 0' }, '打卡两天以上就能看到趋势'));
  }
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max - min < 1e-6) {
    max += 1;
    min -= 1;
  }
  const pad = 6;
  const x = (i) => pad + (i * (W - pad * 2)) / (days - 1);
  const y = (v) => H - pad - ((v - min) * (H - pad * 2)) / (max - min);
  const segs = [];
  let cur = [];
  pts.forEach((v, i) => {
    if (v == null) {
      if (cur.length) segs.push(cur);
      cur = [];
    } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur);
  const lastIdx = pts.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
  const lastV = pts[lastIdx];
  const svg =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}" aria-hidden="true">` +
    segs.map((s) => (s.length > 1 ? `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${s.join(' ')}"/>` : `<circle cx="${s[0].split(',')[0]}" cy="${s[0].split(',')[1]}" r="2.5" fill="${color}"/>`)).join('') +
    `<circle cx="${x(lastIdx).toFixed(1)}" cy="${y(lastV).toFixed(1)}" r="3.5" fill="${color}"/>` +
    `</svg>`;
  return h(
    'div',
    { class: 'hl-spark' },
    h('div', { class: 'hl-spark-head' }, h('b', {}, label), h('span', {}, `${fmt(lastV)} ${unit}`)),
    h('div', { html: svg }),
    h('div', { class: 'hl-spark-foot muted' }, h('span', {}, `30 天低 ${fmt(Math.min(...vals))}`), h('span', {}, `高 ${fmt(Math.max(...vals))}`))
  );
}

async function runAI() {
  if (hs.aiBusy) return;
  const recent = hs.logs.slice(0, 21);
  if (!recent.length) {
    toast('先打卡几天，AI 才有数据可看', 'err');
    return;
  }
  hs.aiBusy = true;
  hs.ai = '';
  render();
  try {
    const sp = state.selfProfile || {};
    const lines = recent
      .map((r) => `${String(r.log_date).slice(0, 10)} 心情${r.mood ?? '-'}/5 精力${r.energy ?? '-'}/5 睡${r.sleep_hours ?? '-'}h 体重${r.weight_kg ?? '-'}kg 运动${r.exercise_min ?? '-'}分 步数${r.steps ?? '-'} 喝水${r.water_cups ?? '-'}杯 ${r.note || ''}`)
      .join('\n');
    hs.ai = await askAI(
      `下面是我最近的健康打卡（新的在前）。${sp.gender ? '性别：' + sp.gender + '。' : ''}${sp.height ? '身高：' + sp.height + '。' : ''}
请用 300 字以内：1) 一句话总结我最近的身体和情绪状态；2) 指出 1-2 个值得注意的趋势（引用具体数字）；3) 给 3 条这周就能做的具体建议（作息、运动、饮食、情绪任选）。

${lines}`
    );
  } catch (e) {
    hs.ai = '';
    toast('AI 暂时用不了：' + (e.message || e), 'err');
  }
  hs.aiBusy = false;
  render();
}

function kpis() {
  const s = healthSummary();
  const k = (lbl, val, sub) => h('div', { class: 'kpi' }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val', style: 'font-size:20px' }, val), sub ? h('div', { class: 'sub' }, sub) : null);
  const moodEm = s.mood ? MOOD_SCALE[Math.max(0, Math.min(4, Math.round(s.mood) - 1))].em : '';
  return h(
    'div',
    { class: 'grid g4', style: 'margin-bottom:16px' },
    k('近 7 天睡眠', s.sleep ? s.sleep.toFixed(1) + ' h' : '—', s.sleep ? (s.sleep < 6.5 ? '偏少' : s.sleep > 9 ? '偏多' : '正常') : '还没数据'),
    k('近 7 天心情', s.mood ? `${moodEm} ${s.mood.toFixed(1)}` : '—', '满分 5'),
    k('近 7 天运动', s.exercise ? s.exercise + ' 分钟' : '—', s.exercise >= 150 ? '达到每周 150 分钟' : '建议每周 150 分钟'),
    k('最近体重', s.weight ? s.weight + ' kg' : '—', '')
  );
}

export function healthView() {
  if (!hs.loaded) {
    return h('div', {}, head(), h('div', { class: 'card muted' }, h('span', { class: 'spinner spinner-sm' }), ' 正在读取…'));
  }
  if (hs.missing) return h('div', {}, head(), setupCard('健康打卡'));
  if (!hs.form) hs.form = blankForm(todayStr());
  return h(
    'div',
    {},
    head(),
    kpis(),
    h('div', { class: 'grid g2', style: 'align-items:start' }, checkinCard(), h(
      'div',
      { class: 'card' },
      h('h3', { class: 'card-title' }, '近 30 天趋势'),
      h(
        'div',
        { class: 'hl-sparks' },
        spark('mood', '心情', '/5', '#d9a03a'),
        spark('sleep_hours', '睡眠', 'h', '#4a6fa5'),
        spark('weight_kg', '体重', 'kg', '#b4552f'),
        spark('exercise_min', '运动', '分钟', '#3f8c5e')
      )
    )),
    h(
      'div',
      { class: 'card', style: 'margin-top:16px' },
      h('h3', { class: 'card-title' }, 'AI 健康建议', h('button', { class: 'btn btn-sm btn-ghost', disabled: hs.aiBusy, onclick: runAI }, hs.aiBusy ? h('span', { class: 'spinner spinner-sm' }) : hs.ai ? '重新分析' : '看看我的状态')),
      hs.ai ? h('div', { class: 'ai-text' }, hs.ai) : h('div', { class: 'muted', style: 'font-size:12.5px' }, '根据最近三周的打卡，总结状态、找出趋势、给出这周能做的具体建议。不是医疗诊断，身体不适请就医。')
    ),
    historyCard()
  );
}

function historyCard() {
  const rows = hs.logs.slice(0, 14);
  if (!rows.length) return null;
  return h(
    'div',
    { class: 'card', style: 'margin-top:16px' },
    h('h3', { class: 'card-title' }, '最近打卡'),
    h(
      'div',
      { class: 'hl-hist' },
      ...rows.map((r) =>
        h(
          'button',
          {
            class: 'hl-hist-row',
            onclick: () => {
              hs.form = blankForm(String(r.log_date).slice(0, 10));
              document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
              render();
            }
          },
          h('span', { class: 'd' }, String(r.log_date).slice(5, 10)),
          h('span', {}, r.mood ? MOOD_SCALE[r.mood - 1]?.em : '·'),
          h(
            'span',
            { class: 'muted' },
            [r.sleep_hours != null ? `睡 ${r.sleep_hours}h` : '', r.weight_kg != null ? `${r.weight_kg}kg` : '', r.exercise_min ? `动 ${r.exercise_min}分` : '', r.steps ? `${r.steps}步` : ''].filter(Boolean).join(' · ') || r.note || '—'
          )
        )
      )
    )
  );
}

function head() {
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, '身体健康'), h('p', { class: 'desc' }, '每天 30 秒打卡，身体是一切的本钱')));
}
