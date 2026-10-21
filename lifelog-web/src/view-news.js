/* 新闻关注：固定盯 6 个话题（两家长江食品公司、伦教长江中心、澳洲经济、美国经济、澳洲房市）。
   应用自己不能上网抓新闻（浏览器跨域限制，国内也打不开很多源），所以做成三步：
     1. 一键搜最新 —— 每个话题直达 百度资讯 / 必应新闻 / 企查查 / 官方数据源，按时间排序；
     2. 收藏 —— 单条粘贴，或把整页搜索结果一次粘进来让 AI 拆成多条；
     3. AI 解读 —— 单条判断对我的影响，或按话题出「专题简报」，也能直接问经济与房产顾问。
   数据存在 signals 表（见 news.js 的约定），不影响原来的利好消息。 */
import { h, render, toast, state, ask } from './store.js';
import { listNews, saveSignal, deleteSignal, errText, isMissingTable } from './cloud.js';
import { askAI, askJSON } from './ai.js';
import { analyzeSignal, scoreBadge } from './view-signals.js';
import { setupCard } from './view-setup.js';
import { openExpert } from './view-expert.js';
import { NEWS_TOPICS, newsTopic, parseNewsSource, makeNewsSource, searchLinks, groupNews, newsDigestText } from './news.js';

let nw = { loaded: false, missing: false, items: [], topic: '', tab: 'new', form: null, busy: false, analyzing: {}, briefBusy: '' };

export async function loadNews() {
  try {
    nw.items = (await listNews()) || [];
    nw.missing = false;
  } catch (e) {
    if (isMissingTable(e)) nw.missing = true;
    else throw e;
  }
  nw.loaded = true;
  render();
}

/** 首页用：每个话题的未读数和最新一条 */
export function newsSummary() {
  const g = groupNews(nw.items);
  const topics = NEWS_TOPICS.map((t) => ({ t, unread: g[t.k].filter((x) => x.status === 'new').length, latest: g[t.k][0] || null }));
  return { loaded: nw.loaded, missing: nw.missing, unread: topics.reduce((a, x) => a + x.unread, 0), topics };
}

/** 从首页 / 别的页面跳进来时直接定位到某个话题 */
export function focusNewsTopic(k) {
  nw.topic = newsTopic(k) ? k : '';
}

/* ---------- 本机小记：上次搜过的时间、专题简报（只是方便，丢了不影响数据） ---------- */

const SEEN_KEY = 'lifelog.news.seen.v1';
const BRIEF_KEY = 'lifelog.news.brief.v1';

function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function writeLocal(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch (e) {
    /* 存不了就算了 */
  }
}

function markSearched(k) {
  const seen = readLocal(SEEN_KEY);
  seen[k] = new Date().toISOString();
  writeLocal(SEEN_KEY, seen);
  render();
}

function searchedLabel(k) {
  const at = readLocal(SEEN_KEY)[k];
  if (!at) return '还没搜过';
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  return days <= 0 ? '今天搜过' : `${days} 天前搜过`;
}

/* ---------- 动作 ---------- */

async function runAnalyze(item) {
  if (nw.analyzing[item.id]) return;
  nw.analyzing[item.id] = true;
  render();
  try {
    const { topic, source } = parseNewsSource(item.source);
    const t = newsTopic(topic);
    /* AI 看到的来源写成「话题全称 + 原来源」，保存时 source 原样不动 */
    const r = await analyzeSignal({ ...item, title: (t ? `［${t.full}］` : '') + item.title, source });
    await saveSignal({ ...item, ...r, area: item.area || r.area });
    await loadNews();
  } catch (e) {
    toast('AI 分析没成功：' + (e.message || e), 'err');
  }
  delete nw.analyzing[item.id];
  render();
}

async function setStatus(item, status) {
  try {
    await saveSignal({ ...item, status });
    await loadNews();
  } catch (e) {
    toast('操作失败：' + errText(e), 'err');
  }
}

async function markTopicRead(k) {
  const list = groupNews(nw.items)[k].filter((x) => x.status === 'new');
  if (!list.length) return;
  try {
    for (const it of list) await saveSignal({ ...it, status: 'archived' });
    toast(`已把 ${list.length} 条标为已读`);
    await loadNews();
  } catch (e) {
    toast('操作失败：' + errText(e), 'err');
  }
}

/* 转成利好消息：去掉「关注:」标记，它就出现在利好消息页，按机会来跟进 */
async function toSignal(item) {
  const { source } = parseNewsSource(item.source);
  try {
    await saveSignal({ ...item, source, status: 'new' });
    toast('已转到「利好消息」');
    await loadNews();
  } catch (e) {
    toast('操作失败：' + errText(e), 'err');
  }
}

async function remove(item) {
  if (!(await ask('删除这条新闻？'))) return;
  try {
    await deleteSignal(item.id);
    await loadNews();
  } catch (e) {
    toast('删除失败：' + errText(e), 'err');
  }
}

async function makeBrief(k) {
  const t = newsTopic(k);
  if (!t || nw.briefBusy) return;
  nw.briefBusy = k;
  render();
  try {
    const sp = state.selfProfile || {};
    const text = await askAI(
      `请为我写一份「${t.full}」专题简报。
我关注它的原因：${t.watch}。
关于我：${[sp.job && '职业 ' + sp.job, sp.city && '城市 ' + sp.city].filter(Boolean).join('，') || '（没填）'}。

下面是我收藏的相关新闻（日期是收藏日期）：
${newsDigestText(nw.items, { perTopic: 12, onlyTopic: k })}

要求：
1. 先一句话总结最近的走向；然后「📌 关键事实」3-5 条（只用上面新闻里的事实，标注日期）；「💡 对我的影响」2-3 条；「✅ 接下来盯什么 / 做什么」2-3 条。
2. 新闻里没有的信息不要编。如果收藏太少，直接说「资料不够」，并列出我应该去搜的 3 个关键词。
3. 不推荐具体股票、基金、楼盘；涉及投资只谈原则和风险。
4. 350 字以内。`
    );
    const all = readLocal(BRIEF_KEY);
    all[k] = { text, at: new Date().toISOString(), n: groupNews(nw.items)[k].length };
    writeLocal(BRIEF_KEY, all);
  } catch (e) {
    toast('AI 暂时用不了：' + (e.message || e), 'err');
  }
  nw.briefBusy = '';
  render();
}

/* ---------- 收藏表单：单条 / 整页粘贴让 AI 拆条 ---------- */

function openForm() {
  nw.form = { mode: 'one', topic: nw.topic || NEWS_TOPICS[0].k, title: '', content: '', url: '', source: '', analyze: true, bulk: '', parsed: null };
  render();
}

function closeForm() {
  nw.form = null;
  render();
}

async function submitOne() {
  const f = nw.form;
  if (!f.title.trim() && !f.content.trim()) {
    toast('粘贴标题或内容', 'err');
    return;
  }
  nw.busy = true;
  render();
  try {
    const rows = await saveSignal({ title: f.title, content: f.content, url: f.url, source: makeNewsSource(f.topic, f.source), area: 'money' });
    const saved = Array.isArray(rows) ? rows[0] : rows;
    nw.form = null;
    nw.topic = f.topic;
    toast('已收藏');
    await loadNews();
    if (f.analyze && saved?.id) runAnalyze({ ...saved });
  } catch (e) {
    toast('保存失败：' + errText(e), 'err');
  }
  nw.busy = false;
  render();
}

async function parseBulk() {
  const f = nw.form;
  const raw = f.bulk.trim();
  if (raw.length < 10) {
    toast('先把搜索结果整页复制粘贴进来', 'err');
    return;
  }
  nw.busy = true;
  render();
  try {
    const t = newsTopic(f.topic);
    const j = await askJSON(
      `下面是从新闻搜索结果页 / 文章里复制的一段文字，话题是「${t.full}」。把其中每一条独立的新闻拆出来。
只保留和「${t.full}」真正相关的；广告、导航、无关内容丢掉；同一事件只留一条。

${raw.slice(0, 6000)}

输出 JSON：{"items":[{"title":"新闻标题","summary":"一两句摘要，60 字以内，只用原文信息","source":"媒体名，没有就空","date":"原文里的日期，没有就空","url":"原文里的链接，没有就空"}]}，最多 15 条。`,
      { timeoutMs: 120000 }
    );
    const items = (Array.isArray(j.items) ? j.items : [])
      .map((x) => ({
        title: String(x.title || '').trim(),
        summary: String(x.summary || '').trim(),
        source: String(x.source || '').trim(),
        date: String(x.date || '').trim(),
        url: /^https?:\/\//.test(String(x.url || '')) ? String(x.url).trim() : '',
        pick: true
      }))
      .filter((x) => x.title)
      .slice(0, 15);
    if (!items.length) toast('没认出新闻条目，换一段试试，或用「单条」手动填', 'err');
    f.parsed = items;
  } catch (e) {
    toast('AI 拆条没成功：' + (e.message || e), 'err');
  }
  nw.busy = false;
  render();
}

async function saveBulk() {
  const f = nw.form;
  const picks = (f.parsed || []).filter((x) => x.pick);
  if (!picks.length) {
    toast('至少勾一条', 'err');
    return;
  }
  /* 已经收藏过的同标题新闻跳过，重复粘贴同一页不会翻倍 */
  const have = new Set(groupNews(nw.items)[f.topic].map((x) => String(x.title).trim()));
  const fresh = picks.filter((x) => !have.has(x.title));
  nw.busy = true;
  render();
  let ok = 0;
  try {
    for (const x of fresh) {
      await saveSignal({ title: x.title, content: [x.date && '日期：' + x.date, x.summary].filter(Boolean).join('\n'), url: x.url, source: makeNewsSource(f.topic, x.source), area: 'money' });
      ok++;
    }
    toast(`收藏了 ${ok} 条${picks.length > fresh.length ? `，${picks.length - fresh.length} 条以前收藏过已跳过` : ''}`);
    nw.topic = f.topic;
    nw.form = null;
    await loadNews();
  } catch (e) {
    toast(`存到第 ${ok + 1} 条失败：` + errText(e), 'err');
    await loadNews().catch(() => {});
  }
  nw.busy = false;
  render();
}

function formSheet() {
  const f = nw.form;
  if (!f) return null;
  const tabs = h(
    'div',
    { class: 'seg', style: 'margin-bottom:12px' },
    h('button', { class: f.mode === 'one' ? 'on' : '', onclick: () => ((f.mode = 'one'), render()) }, '单条'),
    h('button', { class: f.mode === 'bulk' ? 'on' : '', onclick: () => ((f.mode = 'bulk'), render()) }, '整页粘贴 · AI 拆条')
  );
  const topicChips = h(
    'div',
    { class: 'chip-row', style: 'margin-bottom:12px' },
    ...NEWS_TOPICS.map((t) => h('button', { class: 'chip' + (f.topic === t.k ? ' on' : ''), onclick: () => ((f.topic = t.k), render()) }, t.emoji + ' ' + t.label))
  );
  const one = [
    h('input', { class: 'input', id: 'nw-title', placeholder: '新闻标题', value: f.title, oninput: (ev) => (f.title = ev.target.value) }),
    h('textarea', { class: 'input', id: 'nw-content', rows: 6, style: 'margin-top:8px;resize:vertical', placeholder: '正文或摘要（粘贴进来）', value: f.content, oninput: (ev) => (f.content = ev.target.value) }),
    h(
      'div',
      { class: 'row', style: 'gap:8px;margin-top:8px' },
      h('input', { class: 'input', id: 'nw-source', placeholder: '来源，例如 澳洲金融评论（选填）', value: f.source, oninput: (ev) => (f.source = ev.target.value) }),
      h('input', { class: 'input', id: 'nw-url', type: 'url', placeholder: '链接（选填）', value: f.url, oninput: (ev) => (f.url = ev.target.value) })
    ),
    h('label', { class: 'row', style: 'gap:8px;margin-top:12px;font-size:13px;cursor:pointer' }, h('input', { type: 'checkbox', checked: f.analyze, onchange: (ev) => (f.analyze = ev.target.checked) }), '保存后让 AI 判断对我的影响')
  ];
  const bulk = f.parsed
    ? [
        h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, `认出 ${f.parsed.length} 条，取消勾选不要的：`),
        ...f.parsed.map((x) =>
          h(
            'label',
            { class: 'nw-pick' },
            h('input', { type: 'checkbox', checked: x.pick, onchange: (ev) => (x.pick = ev.target.checked) }),
            h('div', { style: 'flex:1;min-width:0' }, h('b', {}, x.title), h('div', { class: 'muted', style: 'font-size:12px' }, [x.date, x.source].filter(Boolean).join(' · ')), x.summary ? h('div', { style: 'font-size:12.5px;margin-top:2px' }, x.summary) : null)
          )
        ),
        h('button', { class: 'link', style: 'font-size:12px;margin-top:8px', onclick: () => ((f.parsed = null), render()) }, '← 重新粘贴')
      ]
    : [
        h('div', { class: 'muted', style: 'font-size:12px;line-height:1.7;margin-bottom:8px' }, '先点话题卡上的「百度资讯」等按钮搜最新新闻，在结果页全选复制，回来粘贴到下面。AI 会拆成一条条，你勾选后保存。'),
        h('textarea', { class: 'input', id: 'nw-bulk', rows: 9, style: 'resize:vertical', placeholder: '把整页搜索结果粘贴到这里', value: f.bulk, oninput: (ev) => (f.bulk = ev.target.value) })
      ];
  const foot =
    f.mode === 'one'
      ? h('button', { class: 'btn btn-sm btn-accent', id: 'nw-save', disabled: nw.busy, onclick: submitOne }, nw.busy ? h('span', { class: 'spinner spinner-sm' }) : '收藏')
      : f.parsed
      ? h('button', { class: 'btn btn-sm btn-accent', id: 'nw-bulk-save', disabled: nw.busy, onclick: saveBulk }, nw.busy ? h('span', { class: 'spinner spinner-sm' }) : `保存选中的 ${f.parsed.filter((x) => x.pick).length} 条`)
      : h('button', { class: 'btn btn-sm btn-accent', id: 'nw-parse', disabled: nw.busy, onclick: parseBulk }, nw.busy ? h('span', { class: 'spinner spinner-sm' }) : 'AI 拆条');
  return h(
    'div',
    { class: 'editor', onclick: (ev) => ev.target.classList.contains('editor') && closeForm() },
    h(
      'div',
      { class: 'editor-panel editor-panel-narrow' },
      h('div', { class: 'editor-head' }, h('span', {}, '收藏新闻'), h('div', { style: 'flex:1' }), h('button', { class: 'btn btn-sm btn-ghost', onclick: closeForm }, '关闭')),
      h('div', { class: 'editor-body' }, h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, '属于哪个话题'), topicChips, tabs, ...(f.mode === 'one' ? one : bulk)),
      h('div', { class: 'editor-foot' }, h('div', { class: 'row' }, h('div', { style: 'flex:1' }), foot))
    )
  );
}

/* ---------- 视图 ---------- */

function localDate(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return String(iso || '').slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function linkBtn(l, k) {
  return h('a', { class: 'btn btn-xs nw-search', href: l.url, target: '_blank', rel: 'noopener noreferrer', onclick: () => markSearched(k) }, l.label + ' ↗');
}

/* 话题总览：6 张卡，一眼看哪个话题有新东西、多久没搜了 */
function topicGrid(g) {
  return h(
    'div',
    { class: 'nw-grid' },
    ...NEWS_TOPICS.map((t) => {
      const list = g[t.k];
      const unread = list.filter((x) => x.status === 'new').length;
      return h(
        'button',
        { class: 'nw-topic' + (unread ? ' hot' : ''), onclick: () => ((nw.topic = t.k), render()) },
        h('div', { class: 'nw-topic-head' }, h('span', { class: 'nw-em' }, t.emoji), h('b', {}, t.label), unread ? h('span', { class: 'nw-dot' }, unread) : null),
        h('div', { class: 'nw-latest' }, list[0] ? list[0].title : '还没有收藏'),
        h('div', { class: 'muted', style: 'font-size:11px' }, `${list.length} 条 · ${searchedLabel(t.k)}`)
      );
    })
  );
}

function topicPanel(t, g) {
  const brief = readLocal(BRIEF_KEY)[t.k];
  const unread = g[t.k].filter((x) => x.status === 'new').length;
  return h(
    'div',
    { class: 'card nw-panel' },
    h('div', { class: 'row-between', style: 'gap:8px;flex-wrap:wrap' }, h('h3', { class: 'card-title', style: 'margin:0' }, t.emoji + ' ' + t.full), h('span', { class: 'muted', style: 'font-size:12px' }, searchedLabel(t.k))),
    h('div', { class: 'muted', style: 'font-size:12.5px;margin:6px 0 10px;line-height:1.7' }, '盯什么：' + t.watch),
    h('div', { class: 'muted', style: 'font-size:11.5px;margin-bottom:6px' }, '① 一键搜最新（按时间排序，新窗口打开）'),
    h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ...searchLinks(t).map((l) => linkBtn(l, t.k))),
    h('div', { class: 'muted', style: 'font-size:11.5px;margin:12px 0 6px' }, '② 看到有用的就收藏 ③ 让 AI 帮你看'),
    h(
      'div',
      { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
      h('button', { class: 'btn btn-xs btn-accent', onclick: openForm }, '+ 收藏'),
      h('button', { class: 'btn btn-xs', id: 'nw-brief', disabled: nw.briefBusy === t.k, onclick: () => makeBrief(t.k) }, nw.briefBusy === t.k ? h('span', { class: 'spinner spinner-sm' }) : brief ? '刷新专题简报' : 'AI 专题简报'),
      h('button', { class: 'btn btn-xs', onclick: () => openExpert('econ') }, '📈 问经济与房产顾问'),
      unread ? h('button', { class: 'btn btn-xs btn-ghost', onclick: () => markTopicRead(t.k) }, `全部标为已读（${unread}）`) : null
    ),
    brief
      ? h(
          'div',
          { style: 'margin-top:12px' },
          h('div', { class: 'muted', style: 'font-size:11px;margin-bottom:4px' }, `专题简报 · ${localDate(brief.at)} 生成，基于当时 ${brief.n} 条收藏`),
          h('div', { class: 'ai-text' }, brief.text)
        )
      : null
  );
}

function card(item) {
  const { topic, source } = parseNewsSource(item.source);
  const t = newsTopic(topic);
  const busy = !!nw.analyzing[item.id];
  const read = item.status !== 'new';
  return h(
    'div',
    { class: 'card sg-card' + (read ? ' nw-read' : '') },
    h(
      'div',
      { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-bottom:6px' },
      t ? h('span', { class: 'sg-area', style: 'color:var(--blue);border-color:var(--blue)' }, t.emoji + ' ' + t.label) : null,
      read ? null : h('span', { class: 'nw-new' }, '未读'),
      scoreBadge(item.ai_score),
      h('span', { class: 'muted', style: 'font-size:11.5px;margin-left:auto' }, localDate(item.created_at))
    ),
    item.url ? h('a', { class: 'sg-title nw-link', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, item.title) : h('div', { class: 'sg-title' }, item.title),
    source ? h('div', { class: 'muted', style: 'font-size:12px;margin-top:2px' }, source) : null,
    item.content ? h('div', { class: 'muted sg-content' }, String(item.content).slice(0, 200) + (String(item.content).length > 200 ? '…' : '')) : null,
    item.ai_take
      ? h('div', { class: 'ai-text', style: 'margin-top:10px' }, item.ai_take)
      : busy
      ? h('div', { class: 'muted', style: 'margin-top:10px;font-size:12.5px' }, h('span', { class: 'spinner spinner-sm' }), ' AI 正在分析…')
      : null,
    h(
      'div',
      { class: 'row', style: 'gap:6px;margin-top:12px;flex-wrap:wrap' },
      read ? h('button', { class: 'btn btn-xs btn-ghost', onclick: () => setStatus(item, 'new') }, '标为未读') : h('button', { class: 'btn btn-xs', onclick: () => setStatus(item, 'archived') }, '✓ 已读'),
      h('button', { class: 'btn btn-xs btn-ghost', disabled: busy, onclick: () => runAnalyze(item) }, item.ai_take ? '重新分析' : 'AI 分析影响'),
      h('button', { class: 'btn btn-xs btn-ghost', title: '当作机会来跟进', onclick: () => toSignal(item) }, '转到利好消息'),
      h('button', { class: 'btn btn-xs btn-ghost', style: 'margin-left:auto;color:var(--red)', onclick: () => remove(item) }, '删除')
    )
  );
}

export function newsView() {
  const head = h(
    'div',
    { class: 'page-head' },
    h('div', {}, h('h1', {}, '新闻关注'), h('p', { class: 'desc' }, '长江食品 · 伦教长江中心 · 澳洲 / 美国经济 · 澳洲房市')),
    nw.missing ? null : h('button', { class: 'btn btn-accent', id: 'nw-add', onclick: openForm }, '+ 收藏新闻')
  );
  if (!nw.loaded) return h('div', {}, head, h('div', { class: 'card muted' }, h('span', { class: 'spinner spinner-sm' }), ' 正在读取…'));
  if (nw.missing) return h('div', {}, head, setupCard('新闻关注'));

  const g = groupNews(nw.items);
  const t = newsTopic(nw.topic);
  const pool = t ? g[t.k] : Object.values(g).flat().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const unreadAll = pool.filter((x) => x.status === 'new').length;
  const list = nw.tab === 'new' ? pool.filter((x) => x.status === 'new') : pool;

  return h(
    'div',
    {},
    head,
    h(
      'div',
      { class: 'chip-row nw-chips', style: 'margin-bottom:12px' },
      h('button', { class: 'chip' + (!t ? ' on' : ''), onclick: () => ((nw.topic = ''), render()) }, '全部'),
      ...NEWS_TOPICS.map((x) => {
        const n = g[x.k].filter((r) => r.status === 'new').length;
        return h('button', { class: 'chip' + (nw.topic === x.k ? ' on' : ''), onclick: () => ((nw.topic = x.k), render()) }, x.emoji + ' ' + x.label, n ? h('span', { class: 'chip-n' }, n) : null);
      })
    ),
    t ? topicPanel(t, g) : topicGrid(g),
    h(
      'div',
      { class: 'row', style: 'gap:8px;margin:14px 0 10px' },
      h('div', { class: 'seg' }, h('button', { class: nw.tab === 'new' ? 'on' : '', onclick: () => ((nw.tab = 'new'), render()) }, `未读 ${unreadAll}`), h('button', { class: nw.tab === 'all' ? 'on' : '', onclick: () => ((nw.tab = 'all'), render()) }, `全部 ${pool.length}`))
    ),
    list.length
      ? h('div', { class: 'sg-list' }, ...list.map(card))
      : h('div', { class: 'empty' }, h('div', { class: 'big' }, '🗞️'), h('p', {}, nw.tab === 'new' && pool.length ? '都看完了 👍' : t ? '这个话题还没有收藏。点上面的「百度资讯」等按钮搜最新消息，有用的就「+ 收藏」。' : '先点一个话题，一键搜最新新闻，有用的就收藏进来。')),
    formSheet()
  );
}
