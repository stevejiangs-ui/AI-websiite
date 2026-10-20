/* 穿搭形象：拍照记录每天的穿搭 / 发型 / 想买的单品，形成自己的形象相册；
   AI 结合场合、你的记录和八字幸运色给穿搭建议。
   照片在手机上先压缩（最长边 1000px，约 100KB 以内）再存，不占多少空间。 */
import { h, render, toast, state, todayStr, ask } from './store.js';
import { listLooks, saveLook, deleteLook, errText, isMissingTable } from './cloud.js';
import { askAI } from './ai.js';
import { luckyToday } from './lucky.js';
import { setupCard } from './view-setup.js';

export const LOOK_KINDS = [
  { k: 'outfit', label: '穿搭', em: '👔' },
  { k: 'photo', label: '形象照', em: '📸' },
  { k: 'idea', label: '想买', em: '🛍️' },
  { k: 'note', label: '心得', em: '✎' }
];

const OCCASIONS = ['日常', '上班', '见客户', '约会', '家庭聚会', '运动', '旅行', '正式场合'];

let lk = { loaded: false, items: [], missing: false, filter: '', form: null, busy: false, adv: { occasion: '', text: '', busy: false }, view: null };

export async function loadLooks() {
  try {
    lk.items = (await listLooks()) || [];
    lk.missing = false;
  } catch (e) {
    if (isMissingTable(e)) lk.missing = true;
    else throw e;
  }
  lk.loaded = true;
  render();
}

export function looksRecent(n = 4) {
  return (lk.items || []).filter((x) => x.url).slice(0, n);
}

export function looksLoaded() {
  return lk.loaded;
}

/* ---------- 照片压缩 ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这张图片打不开，换一张试试'));
    };
    img.src = url;
  });
}

export async function compressPhoto(file, maxSide = 1000, maxBytes = 140 * 1024) {
  const img = await loadImage(file);
  let side = maxSide;
  let q = 0.78;
  for (let i = 0; i < 6; i += 1) {
    const scale = Math.min(1, side / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const hh = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hh;
    c.getContext('2d').drawImage(img, 0, 0, w, hh);
    const data = c.toDataURL('image/jpeg', q);
    if (data.length * 0.75 <= maxBytes) return data;
    if (q > 0.55) q -= 0.1;
    else side = Math.round(side * 0.8);
  }
  throw new Error('图片太大了，压缩后还是放不下，换一张小一点的');
}

/* ---------- 新增 / 编辑 ---------- */

function openForm(item) {
  lk.form = item
    ? { ...item, occasion: tagOccasion(item.tags) }
    : { kind: lk.filter || 'outfit', title: '', url: '', note: '', tags: '', taken_at: todayStr(), occasion: '日常' };
  render();
}

function tagOccasion(tags) {
  return String(tags || '').split(/[,，\s]+/).find((t) => OCCASIONS.includes(t)) || '';
}

async function onPhoto(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  lk.busy = true;
  render();
  try {
    lk.form.url = await compressPhoto(file);
  } catch (e) {
    toast(e.message || String(e), 'err');
  }
  lk.busy = false;
  render();
}

async function submit() {
  const f = lk.form;
  if (!f.url && !f.title.trim() && !f.note.trim()) {
    toast('拍张照片，或者写点什么', 'err');
    return;
  }
  const others = String(f.tags || '').split(/[,，\s]+/).filter((t) => t && !OCCASIONS.includes(t));
  const tags = [f.occasion, ...others].filter(Boolean).join(' ');
  lk.busy = true;
  render();
  try {
    await saveLook({ ...f, tags, title: f.title.trim() || f.occasion || '' });
    lk.form = null;
    toast('已保存');
    await loadLooks();
  } catch (e) {
    toast('保存失败：' + errText(e), 'err');
  }
  lk.busy = false;
  render();
}

async function remove(item) {
  if (!(await ask('删除这条记录？'))) return;
  try {
    await deleteLook(item.id);
    lk.view = null;
    toast('已删除');
    await loadLooks();
  } catch (e) {
    toast('删除失败：' + errText(e), 'err');
  }
}

function formSheet() {
  const f = lk.form;
  if (!f) return null;
  return h(
    'div',
    { class: 'editor', onclick: (ev) => ev.target.classList.contains('editor') && ((lk.form = null), render()) },
    h(
      'div',
      { class: 'editor-panel editor-panel-narrow' },
      h('div', { class: 'editor-head' }, h('span', {}, f.id ? '编辑' : '记一套'), h('div', { style: 'flex:1' }), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => ((lk.form = null), render()) }, '关闭')),
      h(
        'div',
        { class: 'editor-body' },
        h('div', { class: 'seg', style: 'margin-bottom:12px' }, ...LOOK_KINDS.map((k) => h('button', { class: f.kind === k.k ? 'on' : '', onclick: () => ((f.kind = k.k), render()) }, k.em + ' ' + k.label))),
        h(
          'label',
          { class: 'lk-photo' + (f.url ? ' has' : '') },
          f.url ? h('img', { src: f.url, alt: '照片' }) : h('div', { class: 'lk-photo-ph' }, lk.busy ? h('span', { class: 'spinner spinner-sm' }) : '📷 拍照 / 选一张照片'),
          h('input', { type: 'file', accept: 'image/*', id: 'lk-file', style: 'display:none', onchange: onPhoto })
        ),
        f.url ? h('button', { class: 'link', style: 'font-size:12px;margin-top:6px', onclick: () => ((f.url = ''), render()) }, '去掉照片') : null,
        h('div', { class: 'muted', style: 'font-size:12px;margin:12px 0 6px' }, '场合'),
        h('div', { class: 'chip-row' }, ...OCCASIONS.map((o) => h('button', { class: 'chip' + (f.occasion === o ? ' on' : ''), onclick: () => ((f.occasion = f.occasion === o ? '' : o), render()) }, o))),
        h('input', { class: 'input', id: 'lk-title', style: 'margin-top:12px', placeholder: f.kind === 'idea' ? '想买什么？例如：深蓝色西装外套' : '一句话描述，例如：白衬衫 + 卡其裤', value: f.title, oninput: (ev) => (f.title = ev.target.value) }),
        h('textarea', { class: 'input', id: 'lk-note', rows: 3, style: 'margin-top:8px;resize:vertical', placeholder: '心得：别人怎么评价、穿着舒不舒服、哪里可以改进…', value: f.note, oninput: (ev) => (f.note = ev.target.value) }),
        h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, h('input', { class: 'input', id: 'lk-tags', placeholder: '标签（空格分隔，选填）', value: String(f.tags || '').split(/\s+/).filter((t) => !OCCASIONS.includes(t)).join(' '), oninput: (ev) => (f.tags = ev.target.value) }), h('input', { class: 'input', id: 'lk-date', type: 'date', style: 'width:auto', value: f.taken_at || todayStr(), onchange: (ev) => (f.taken_at = ev.target.value) }))
      ),
      h('div', { class: 'editor-foot' }, h('div', { class: 'row' }, f.id ? h('button', { class: 'btn btn-sm btn-ghost', style: 'color:var(--red)', onclick: () => remove(f) }, '删除') : null, h('div', { style: 'flex:1' }), h('button', { class: 'btn btn-sm btn-accent', disabled: lk.busy, onclick: submit }, lk.busy ? h('span', { class: 'spinner spinner-sm' }) : '保存')))
    )
  );
}

/* ---------- AI 穿搭建议 ---------- */

async function advise() {
  const a = lk.adv;
  if (a.busy) return;
  a.busy = true;
  a.text = '';
  render();
  try {
    const sp = state.selfProfile || {};
    const lucky = luckyToday();
    const recent = lk.items
      .slice(0, 15)
      .map((x) => `${x.taken_at || ''} [${LOOK_KINDS.find((k) => k.k === x.kind)?.label || x.kind}] ${x.title || ''} ${x.tags || ''} ${x.note || ''}`.trim())
      .join('\n');
    a.text = await askAI(
      `我要去的场合：${a.occasion || '日常'}。
关于我：${[sp.gender && '性别 ' + sp.gender, sp.height && '身高 ' + sp.height, sp.weight && '体重 ' + sp.weight, sp.job && '职业 ' + sp.job, sp.city && '城市 ' + sp.city].filter(Boolean).join('，') || '（没填）'}
${lucky ? `八字喜用五行：${[...lucky.useful, ...lucky.favorable].join('、')}，幸运色：${lucky.colors.join('、')}，今天${lucky.dayGz}日。` : ''}
我最近的穿搭记录：
${recent || '（还没有记录）'}

请给一套具体的穿搭建议（上衣、下装、鞋、配饰、颜色），说明为什么适合这个场合、怎么显得精神得体；如果有幸运色，自然地融进去（不要整身同色）。再给 1 条我最近可以改进的形象细节。200 字以内。`
    );
  } catch (e) {
    toast('AI 暂时用不了：' + (e.message || e), 'err');
  }
  a.busy = false;
  render();
}

function adviceCard() {
  const a = lk.adv;
  const lucky = luckyToday();
  return h(
    'div',
    { class: 'card', style: 'margin-bottom:16px' },
    h('h3', { class: 'card-title' }, '今天穿什么', lucky ? h('span', { class: 'muted', style: 'font-size:12px;font-weight:400' }, '幸运色：' + lucky.colors.join(' / ')) : null),
    h('div', { class: 'chip-row' }, ...OCCASIONS.map((o) => h('button', { class: 'chip' + (a.occasion === o ? ' on' : ''), onclick: () => ((a.occasion = o), render()) }, o))),
    h('button', { class: 'btn btn-sm btn-accent', style: 'margin-top:12px', disabled: a.busy, onclick: advise }, a.busy ? h('span', { class: 'spinner spinner-sm' }) : '让 AI 给建议'),
    a.text ? h('div', { class: 'ai-text', style: 'margin-top:12px' }, a.text) : null
  );
}

/* ---------- 相册 ---------- */

function gallery() {
  const items = lk.items.filter((x) => !lk.filter || x.kind === lk.filter);
  if (!items.length) {
    return h('div', { class: 'empty' }, h('div', { class: 'big' }, '👔'), h('p', {}, '还没有记录。每天出门前拍一张，一个月后你会看清自己最好看的样子。'), h('button', { class: 'btn btn-accent', onclick: () => openForm(null) }, '记第一套'));
  }
  return h(
    'div',
    { class: 'lk-grid' },
    ...items.map((x) =>
      h(
        'button',
        { class: 'lk-card', onclick: () => openForm(x) },
        x.url ? h('img', { src: x.url, alt: x.title || '穿搭', loading: 'lazy' }) : h('div', { class: 'lk-noimg' }, LOOK_KINDS.find((k) => k.k === x.kind)?.em || '✎'),
        h('div', { class: 'lk-meta' }, h('b', {}, x.title || '（无标题）'), h('span', { class: 'muted' }, [String(x.taken_at || '').slice(5, 10), x.tags].filter(Boolean).join(' · ')))
      )
    )
  );
}

export function looksView() {
  const head = h(
    'div',
    { class: 'page-head' },
    h('div', {}, h('h1', {}, '穿搭形象'), h('p', { class: 'desc' }, '记录每一套穿搭，越来越会打扮')),
    lk.missing ? null : h('button', { class: 'btn btn-accent', onclick: () => openForm(null) }, '+ 记一套')
  );
  if (!lk.loaded) return h('div', {}, head, h('div', { class: 'card muted' }, h('span', { class: 'spinner spinner-sm' }), ' 正在读取…'));
  if (lk.missing) return h('div', {}, head, setupCard('穿搭形象'));
  return h(
    'div',
    {},
    head,
    adviceCard(),
    h('div', { class: 'seg', style: 'margin-bottom:12px' }, h('button', { class: !lk.filter ? 'on' : '', onclick: () => ((lk.filter = ''), render()) }, '全部'), ...LOOK_KINDS.map((k) => h('button', { class: lk.filter === k.k ? 'on' : '', onclick: () => ((lk.filter = k.k), render()) }, k.label))),
    gallery(),
    formSheet()
  );
}
