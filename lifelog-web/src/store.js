import { cloud } from './cloud.js';

export const state = {
  session: null,
  view: 'diary',
  diaryMonth: currentMonth(),
  entries: [],
  entryEditor: null,
  tx: [],
  txMonth: currentMonth(),
  txFilter: { category: '', keyword: '', direction: '' },
  stats: null,
  loading: false,
  chat: [],
  chatBusy: false,
  diaryFacet: '',
  goals: [],
  goalEditor: null,
  /* 目标的提交/更新互斥锁：防止连点插入重复记录、并发覆盖进度 */
  goalSaving: false,
  goalBusy: false,
  birth: undefined,
  /* 页面数据加载失败时的提示文案，由 main.js 的 go() 写入 */
  loadErr: ''
};

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- 轻量渲染框架 ---------- */

let rootEl = null;
let scheduled = false;

export function mountRender(root) {
  rootEl = root;
  window.addEventListener('popstate', () => render());
}

/* 全局渲染入口由 app.js 注入。
   必须声明在 render() 之前 —— render 会引用它，若声明在后面，
   第一次渲染就会抛 ReferenceError，整个应用白屏。 */
let buildRoot = () => h('div', {}, '');

export function setState(patch) {
  Object.assign(state, patch);
  render();
}

export function render() {
  if (!rootEl) return;
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    /* 整棵树重建前，记下所有带 id 的滚动容器的位置和当前焦点。
       原版每次 render 都把 #main-scroll 换成新元素，滚动条回到顶部——
       在手机上往下翻、勾一个待办，页面就跳回最上面。 */
    const scrolls = [];
    rootEl.querySelectorAll('[id]').forEach((el) => {
      if (el.scrollTop || el.scrollLeft) scrolls.push([el.id, el.scrollTop, el.scrollLeft]);
    });
    const winY = window.scrollY;
    const active = document.activeElement;
    if (!focusSnapshot && active && active.id && rootEl.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
      let selStart = null;
      let selEnd = null;
      try {
        selStart = active.selectionStart;
        selEnd = active.selectionEnd;
      } catch (e) {
        /* 某些 input 类型不支持 selection */
      }
      focusSnapshot = { id: active.id, selStart, selEnd };
    }
    rootEl.innerHTML = '';
    rootEl.appendChild(buildTree(buildRoot()));
    scrolls.forEach(([id, top, left]) => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollTop = top;
        el.scrollLeft = left;
      }
    });
    if (winY) window.scrollTo(0, winY);
    restoreFocus();
  });
}

/* 切页面时由调用方主动回到顶部 */
export function scrollTop() {
  requestAnimationFrame(() => {
    const el = document.getElementById('main-scroll');
    if (el) el.scrollTop = 0;
  });
}

/* ---------- 应用内确认 / 输入框 ----------
   浏览器自带的 confirm()/prompt() 在嵌入页（claude.ai 里的应用）里
   可能被直接禁用、静默返回 false——所有「删除」按钮就都点不动了。
   这里用自己画的弹层代替，返回 Promise。 */
function dialog({ message, input = false, value = '', okText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg-wrap';
    const box = document.createElement('div');
    box.className = 'dlg';
    const msg = document.createElement('div');
    msg.className = 'dlg-msg';
    msg.textContent = message;
    box.appendChild(msg);
    let field = null;
    if (input) {
      field = document.createElement('input');
      field.className = 'input';
      field.value = value || '';
      box.appendChild(field);
    }
    const row = document.createElement('div');
    row.className = 'dlg-row';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-sm btn-ghost';
    cancel.textContent = '取消';
    const ok = document.createElement('button');
    ok.className = 'btn btn-sm ' + (danger ? 'btn-danger' : 'btn-accent');
    ok.textContent = okText;
    row.append(cancel, ok);
    box.appendChild(row);
    wrap.appendChild(box);
    const done = (v) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') done(input ? null : false);
      if (ev.key === 'Enter') done(input ? field.value : true);
    };
    cancel.onclick = () => done(input ? null : false);
    ok.onclick = () => done(input ? field.value : true);
    wrap.onclick = (ev) => {
      if (ev.target === wrap) done(input ? null : false);
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    setTimeout(() => (field || ok).focus(), 30);
  });
}

/** 确认框：await ask('删除？') → true / false */
export function ask(message, opts = {}) {
  return dialog({ message, okText: opts.okText || '确定', danger: opts.danger !== false });
}

/** 输入框：await askText('备注', '默认值') → 字符串，取消为 null */
export function askText(message, value = '') {
  return dialog({ message, input: true, value, danger: false });
}

/* 保留焦点位置（输入框不丢光标） */
let focusSnapshot = null;
function restoreFocus() {
  if (!focusSnapshot) return;
  const { id, selStart, selEnd } = focusSnapshot;
  focusSnapshot = null;
  const el = id ? document.getElementById(id) : null;
  if (el && typeof el.focus === 'function') {
    el.focus();
    try {
      if (selStart != null && el.setSelectionRange) el.setSelectionRange(selStart, selEnd);
    } catch (e) {
      /* ignore */
    }
  }
}

/* 原版在按键当下就记下「要还原到哪个输入框」，等下一帧重绘时再还原。
   如果这期间焦点已经移到下一个框（手快、或输入法跳格），重绘会把焦点
   拽回上一个框，后面打的字就落进了错误的格子。
   现在 render() 在重绘那一刻自己记录当前焦点，这里只需触发重绘。 */
export function keepFocus(id) {
  render();
}

/* 声明式 DOM 构造：h('div', {class:'x', onclick: fn}, children) */
export function h(tag, props, ...children) {
  return { tag, props: props || {}, children: children.flat(Infinity).filter((c) => c != null && c !== false) };
}

/* 把一个属性应用到元素上。抽成独立函数而不是写在 buildTree 的循环里，
   一是让主流程更短，二是方便单独看「事件属性」这段兜底逻辑。 */
function applyProp(el, key, value) {
  if (value == null || value === false) return;
  if (key === 'class') el.className = value;
  else if (key === 'style') el.setAttribute('style', value);
  else if (key === 'html') el.innerHTML = value;
  else if (key === 'value') el.value = value;
  else if (key === 'checked') el.checked = !!value;
  else if (key === 'disabled') el.disabled = !!value;
  else if (key.startsWith('on') && typeof value === 'function') {
    bindEvent(el, key.slice(2).toLowerCase(), value);
  } else el.setAttribute(key, value);
}

/* 事件绑定：全站兜底。
   事件处理器经常是 async（发请求、写库），以前直接交给 addEventListener，
   抛错就变成 unhandled rejection —— 用户只看到「点了没反应」，控制台一片红。
   这里统一接住，转成一条 toast，至少让人知道失败了。 */
function bindEvent(el, evt, fn) {
  el.addEventListener(evt, (e) => {
    try {
      const out = fn(e);
      if (out && typeof out.then === 'function') {
        out.catch((err) => {
          console.error('[handler]', err);
          toast(err && err.message ? '操作失败：' + err.message : '操作失败，请重试', 'err');
        });
      }
    } catch (err) {
      console.error('[handler]', err);
      toast(err && err.message ? '操作失败：' + err.message : '操作失败，请重试', 'err');
    }
  });
}

function buildTree(node) {
  if (node == null || node === false) return document.createTextNode('');
  if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node));

  /* 兜底：把 Promise 当节点塞进来（例如某个渲染函数被误写成 async）。
     以前这里会走到 createElement(undefined) 抛错，整个页面白屏——
     一个写错关键字的组件，代价是用户完全进不去。现在只丢掉这一个节点，
     并在控制台点名，其余界面照常渲染。 */
  if (typeof node.then === 'function') {
    console.error('[render] 子节点是 Promise，说明有渲染函数被写成了 async：', node);
    return document.createTextNode('');
  }
  if (typeof node.tag !== 'string') {
    console.error('[render] 非法节点，已跳过：', node);
    return document.createTextNode('');
  }

  const el = document.createElement(node.tag);
  const props = node.props || {};

  for (const [k, val] of Object.entries(props)) {
    applyProp(el, k, val);
  }

  node.children.forEach((c) => {
    const child = buildTree(c);
    if (child) el.appendChild(child);
  });
  return el;
}

export function setRootBuilder(fn) {
  buildRoot = fn;
}

/* toast */
let toastTimer = null;
export function toast(msg, type = '') {
  let box = document.querySelector('.toast');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toast';
    document.body.appendChild(box);
  }
  box.className = 'toast show' + (type === 'err' ? ' err' : '');
  box.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.className = 'toast';
  }, 2600);
}
