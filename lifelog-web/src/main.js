/* 全局样式。必须由 JS 引入，而不是在 index.html 里写 <link>：
   写死 <link href="style.css"> 的话，打包后线上没有这个文件（样式被并进
   assets/index-*.css），页面就变成无样式的白页。 */
import '../style.css';

import { errText, loadRules } from './cloud.js';
import { h, setState, setRootBuilder, mountRender, render, toast, state } from './store.js';
import { diaryView, editorView, loadEntries, openEditor } from './view-diary.js';
import { txView, loadTx } from './view-tx.js';
import { chatView } from './view-chat.js';
import { settingsView, applyNickname } from './view-settings.js';
import { goalsView, loadGoals, loadTasks, goalEditorView, taskEditorView } from './view-goals.js';
import { fortuneView, ensureBirth } from './view-fortune.js';
import { financeView, loadFinance } from './view-finance.js';
import { lifeView, loadLife } from './view-life.js';
import { baziSelfView, loadBaziSelf } from './view-bazi-self.js';
import { homeView, loadHome } from './view-home.js';
import { expertView } from './view-expert.js';
import { peopleView, loadPeople } from './view-people.js';
import { placeView, loadPlaces } from './view-place.js';
import { healthView, loadHealth } from './view-health.js';
import { looksView, loadLooks } from './view-looks.js';
import { signalsView, loadSignals } from './view-signals.js';
import { EXPERTS } from './experts.js';
import { ensureModel } from './ai.js';
import {
  PLATFORM,
  backendReady,
  runtime,
  loadAccount,
  sessionValid,
  hasSession,
  markActive,
  endSession,
  lastActiveAt,
  IDLE_LIMIT_MS,
  touchSession,
  signOutRemote
} from '@platform';
import { setupLogin, loginView } from './view-login.js';
import { recordsView, loadRecords } from './view-records.js';
import { quickSpendFab, quickSpendSheet, openQuickSpend } from './quick-spend.js';

const root = document.getElementById('app');

/* 导航按「人生五件事」分组：财富、家庭、开心、健康、形象，外加机会、命理与工具。
   group 为分组标题（侧栏显示），没有 group 的跟上一个组。 */
const NAV = [
  { k: 'home', label: '首页', icon: '⌂' },
  { k: 'diary', label: '记录', icon: '✎', group: '记录' },
  { k: 'goals', label: '目标 / 任务 / 日程', icon: '◎' },
  { k: 'life', label: '工作与生活', icon: '◈' },
  { k: 'finance', label: '财富总览', icon: '¥', group: '财富' },
  { k: 'tx', label: '账单 / 导入', icon: '≡' },
  { k: 'records', label: '消费记录', icon: '🧾' },
  { k: 'signals', label: '利好消息', icon: '✦' },
  { k: 'people', label: '家人与圈子', icon: '◉', group: '家庭' },
  { k: 'health', label: '身体健康', icon: '✚', group: '身心' },
  { k: 'looks', label: '穿搭形象', icon: '✧' },
  { k: 'bazi', label: '八字', icon: '☯', group: '命理' },
  { k: 'fortune', label: '运势', icon: '☰' },
  { k: 'chat', label: '问问账本', icon: '◌', group: 'AI' },
  { k: 'expert', label: '专家', icon: '🧑‍💼' },
  { k: 'settings', label: '设置', icon: '⚙', group: '' }
];

/* 手机底部标签栏：首页 / 记录 / 财富 / 身心 / 更多 */
const MOBILE_TABS = [
  { k: 'home', label: '首页', icon: '🏠' },
  { k: 'diary', label: '记录', icon: '📝' },
  { k: 'finance', label: '财富', icon: '💰' },
  { k: 'health', label: '身心', icon: '💪' }
];

/* 「更多」弹层里的入口，按板块排 */
const MORE_ITEMS = [
  { k: 'tx', label: '账单 / 记一笔', icon: '💳' },
  { k: 'signals', label: '利好消息', icon: '📰' },
  { k: 'people', label: '家人与圈子', icon: '🏠' },
  { k: 'looks', label: '穿搭形象', icon: '👔' },
  { k: 'goals', label: '目标 / 任务', icon: '🎯' },
  { k: 'life', label: '工作与生活', icon: '💼' },
  { k: 'bazi', label: '八字命理', icon: '☯️' },
  { k: 'fortune', label: '每日运势', icon: '🔮' },
  { k: 'chat', label: '问问账本', icon: '💬' },
  { k: 'expert', label: '专家中心', icon: '🧑‍💼' },
  { k: 'records', label: '消费记录 / 导入旧账', icon: '🧾' },
  { k: 'place', label: '我在哪里', icon: '📍' },
  { k: 'settings', label: '设置', icon: '⚙' }
];

/* ---------------- 主界面 ---------------- */

function shell() {
  const u = state.session?.user || {};
  const name = u.name || u.phone || u.email || '我';
  return h(
    'div',
    { class: 'shell' },
    h(
      'aside',
      { class: 'side' },
      h(
        'div',
        { class: 'brand' },
        h('div', { class: 'brand-mark' }, '我'),
        h('div', { class: 'brand-name' }, '个人APP')
      ),
      ...NAV.flatMap((n) => [
        n.group ? h('div', { class: 'nav-group' }, n.group) : n.group === '' ? h('div', { class: 'nav-gap' }) : null,
        h(
          'button',
          {
            class: 'nav-item' + (state.view === n.k ? ' on' : ''),
            onclick: () => go(n.k)
          },
          h('span', { class: 'ic' }, n.icon),
          n.label
        )
      ]),
      h(
        'div',
        { class: 'side-foot' },
        h(
          'div',
          { class: 'user-chip' },
          h('div', { class: 'avatar' }, String(name).slice(0, 1)),
          h('div', { class: 'user-meta' }, h('b', {}, name), h('span', {}, runtime.mode === 'cloud' ? '云端同步' : '本机模式')),
          h('button', { class: 'link', style: 'font-size:12px', title: '设置', onclick: () => go('settings') }, '⚙'),
          h('button', { class: 'link', style: 'font-size:12px', title: '退出登录', onclick: () => signOut('') }, '⏻')
        )
      )
    ),
    h('main', { class: 'main', id: 'main-scroll' }, localBanner(), state.loadErr ? loadErrBar() : null, currentView()),
    h(
      'nav',
      { class: 'mobile-nav' },
      ...MOBILE_TABS.map((n) =>
        h(
          'button',
          { class: state.view === n.k ? 'on' : '', onclick: () => go(n.k) },
          h('span', { class: 'ic' }, n.icon),
          n.label
        )
      ),
      h(
        'button',
        {
          class: state.view === 'more' ? 'on' : '',
          onclick: () => {
            state.moreOpen = !state.moreOpen;
            render();
          }
        },
        h('span', { class: 'ic' }, '☰'),
        '更多'
      )
    ),
    /* 「更多」弹层 */
    state.moreOpen ? moreSheet() : null,
    editorView(),
    /* 目标编辑面板放全局层：不管当前在哪个视图分支，只要 state.goalEditor
       有值就弹出来。以前挂在 goalsView() 的各分支里，空列表提前 return
       那条路漏挂过一次，表现为「点了没反应」——这类隐患从根上掐掉。 */
    goalEditorView(),
    /* 任务 / 日程编辑面板同样放全局层 */
    taskEditorView(),
    /* 快速记消费：右下角「＋」和它的弹层，任何页面都能用 */
    quickSpendFab(),
    quickSpendSheet()
  );
}

function moreSheet() {
  return h(
    'div',
    {
      class: 'editor more-sheet-wrap',
      onclick: (ev) => {
        if (ev.target.classList.contains('more-sheet-wrap')) {
          state.moreOpen = false;
          render();
        }
      }
    },
    h(
      'div',
      { class: 'more-sheet' },
      h(
        'div',
        { class: 'editor-head' },
        h('span', {}, '更多功能'),
        h('div', { style: 'flex:1' }),
        h(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            onclick: () => {
              state.moreOpen = false;
              render();
            }
          },
          '关闭'
        )
      ),
      h(
        'div',
        { class: 'more-grid' },
        h(
          'button',
          {
            class: 'more-item more-item-accent',
            onclick: () => {
              state.moreOpen = false;
              openQuickSpend();
            }
          },
          h('span', { class: 'em' }, '➕'),
          '记一笔消费'
        ),
        ...MORE_ITEMS.map((n) =>
          h(
            'button',
            {
              class: 'more-item' + (state.view === n.k ? ' on' : ''),
              onclick: () => {
                state.moreOpen = false;
                go(n.k);
              }
            },
            h('span', { class: 'em' }, n.icon),
            n.label
          )
        )
      ),
      h(
        'div',
        { style: 'padding:12px 16px 18px' },
        h('p', { class: 'muted', style: 'margin:0 0 10px;font-size:12px' }, `找专家帮忙 · ${EXPERTS.length} 位`),
        h(
          'div',
          { class: 'expert-grid' },
          ...EXPERTS.map((e) =>
            h(
              'button',
              {
                class: 'expert-card',
                onclick: async () => {
                  state.moreOpen = false;
                  const m = await import('./view-expert.js');
                  m.openExpert(e.id);
                }
              },
              h('span', { class: 'em' }, e.emoji),
              h('span', { class: 'nm' }, e.name),
              h('span', { class: 'tip' }, e.tip)
            )
          )
        )
      )
    )
  );
}

function currentView() {
  switch (state.view) {
    case 'home':
      return homeView();
    case 'expert':
      return expertView();
    case 'goals':
      return goalsView();
    case 'life':
      return lifeView();
    case 'people':
      return peopleView();
    case 'place':
      return placeView();
    case 'health':
      return healthView();
    case 'looks':
      return looksView();
    case 'signals':
      return signalsView();
    case 'bazi':
      return baziSelfView();
    case 'fortune':
      return fortuneView();
    case 'finance':
      return financeView();
    case 'tx':
      return txView();
    case 'records':
      return recordsView();
    /* 上一版叫「档案」，留着这个分支避免旧书签/旧入口白屏 */
    case 'archive':
      return recordsView();
    /* 老的「导入账单」入口：现在并进账单页的「导入」标签 */
    case 'import':
      return txView();
    case 'chat':
      return chatView();
    case 'settings':
      return settingsView();
    default:
      return diaryView();
  }
}

async function go(view) {
  if (state.view === view) return;

  /* 先切视图再拉数据。
     切换本身是同步的，即使后面某个请求失败，界面也已经在新页面上了，
     不会出现「点了没反应」或「白屏」。
     每个加载各自兜错：一个模块的数据拉不到，不该拖垮整页。 */
  const m0 = document.getElementById('main-scroll');
  if (m0) m0.scrollTop = 0;
  setState({ view, expertPicker: false, moreOpen: false, loadErr: '' });

  const fail = (what) => (e) => {
    const msg = errText(e);
    console.error(`[${what}] 加载失败`, e);
    // 只有「登录失效」要往上抛，其余降级为提示
    if (msg.includes('登录已失效')) throw e;
    state.loadErr = `${what}没加载出来：${msg}`;
    render();
  };

  const tasks = [];
  if (view === 'home') tasks.push(loadHome().catch(fail('首页')));
  if (view === 'diary') tasks.push(loadEntries().catch(fail('日记')));
  if (view === 'goals') {
    tasks.push(loadGoals().catch(fail('目标')));
    tasks.push(loadTasks().catch(fail('任务')));
  }
  if (view === 'life') tasks.push(loadLife().catch(fail('生活')));
  if (view === 'people') tasks.push(loadPeople().catch(fail('圈子')));
  if (view === 'place') tasks.push(loadPlaces().catch(fail('位置')));
  if (view === 'health') tasks.push(loadHealth().catch(fail('健康')));
  if (view === 'looks') tasks.push(loadLooks().catch(fail('穿搭')));
  if (view === 'signals') tasks.push(loadSignals().catch(fail('利好消息')));
  if (view === 'bazi') {
    try {
      ensureBirth();
    } catch (e) {
      /* 生辰读不到不影响进页面，页面自己会提示去填 */
    }
    tasks.push(loadBaziSelf().catch(fail('八字')));
  }
  if (view === 'fortune') {
    try {
      ensureBirth();
    } catch (e) {
      /* 同上 */
    }
  }
  if (view === 'finance') tasks.push(loadFinance().catch(fail('财务')));
  if (view === 'tx') tasks.push(loadTx().catch(fail('账单')));
  if (view === 'records' || view === 'archive') tasks.push(loadRecords().catch(fail('消费记录')));
  if (view === 'chat') {
    tasks.push(
      ensureModel()
        .then(() => {
          state.aiOk = true;
        })
        .catch(() => {
          /* 聊天时会自己提示 */
        })
    );
  }

  try {
    await Promise.all(tasks);
  } catch (e) {
    /* 登录失效：回登录页比停在这里更清楚 */
    toast(errText(e), 'err');
    return;
  }

  const main = document.getElementById('main-scroll');
  if (main) main.scrollTop = 0;
  render();
}

/* ---------------- 启动 ---------------- */

window.addEventListener('lifelog-new-entry', (ev) => {
  const facets = ev.detail?.facets || [];
  setState({ diaryFacet: facets[0] || '' });
  openEditor(null);
});

window.addEventListener('lifelog-open-entry', (ev) => {
  const id = ev.detail?.id;
  const hit = (state.entries || []).find((x) => x.id === id);
  if (hit) openEditor(hit);
  else toast('这篇不在当前月份的列表里，先去日记页翻一下', 'err');
});

/* 数据没拉出来时，在页面顶部给一条可关闭的提示。不遮住页面本身。 */
function loadErrBar() {
  return h(
    'div',
    { class: 'load-err' },
    h('span', {}, '⚠ ' + state.loadErr),
    h(
      'button',
      {
        class: 'link',
        style: 'font-size:12px;margin-left:auto',
        onclick: () => {
          state.loadErr = '';
          render();
        }
      },
      '知道了'
    )
  );
}

/* 本机模式提示：脱离 claude.ai 打开时，数据只存在这个浏览器里 */
let localBannerClosed = false;
function localBanner() {
  if (runtime.mode === 'cloud' || localBannerClosed) return null;
  return h(
    'div',
    { class: 'load-err', style: 'background:#fbf3e4;border-color:#ecd9b4;color:#7a5a24' },
    h('span', {}, 'ⓘ 本机模式：数据只保存在这个浏览器里，AI 功能不可用。在 claude.ai 里打开这个应用即可云端同步、手机电脑共用。'),
    h(
      'button',
      {
        class: 'link',
        style: 'font-size:12px;margin-left:auto;white-space:nowrap',
        onclick: () => {
          localBannerClosed = true;
          render();
        }
      },
      '知道了'
    )
  );
}

async function enterApp() {
  setRootBuilder(() => shell());
  setState({ view: 'home' });
  /* 先把壳渲染出来，再去拉数据：任何一次请求失败都不会让页面停在原地 */
  render();
  try {
    await Promise.all([loadHome(), loadRules(), applyNickname()]);
  } catch (e) {
    console.error('[enterApp] 首页数据加载失败', e);
    toast('首页数据没加载完整：' + errText(e), 'err');
  }
  render();
  ensureModel()
    .then(() => {
      state.aiOk = true;
    })
    .catch(() => {
      state.aiOk = false;
    });
}

/* 启动：等后端就绪（claude.ai 里会拿到你的账号与云端存储；
   直接打开 HTML 则退回本机模式），然后进应用。
   没有单独的登录页——在 claude.ai 里，你的 Claude 账号就是登录。 */
async function boot() {
  try {
    setStatus('正在连接数据…');
    await backendReady();
    const acct = await loadAccount();
    state.session = makeSession(acct);
    if (acct && sessionValid()) {
      await enterApp();
    } else {
      let reason = '';
      try {
        reason = sessionStorage.getItem('lifelog-logout-reason') || '';
        sessionStorage.removeItem('lifelog-logout-reason');
      } catch (e) {
        /* ignore */
      }
      /* 本机有会话但已超时：也算「自动退出」 */
      if (acct && hasSession() && !reason) reason = 'idle';
      endSession();
      /* 云端会话也一并结束（WorkBuddy）；不等它，登录页先出来 */
      signOutRemote();
      showLogin(!!acct, reason);
    }
    markBooted();
  } catch (e) {
    showBootError(e);
  }
}

function makeSession(acct) {
  return {
    accessToken: PLATFORM,
    user: { id: runtime.uid || 'local', name: runtime.name || '我', email: acct?.email || runtime.email || '' }
  };
}

function showLogin(hasAccount, reason) {
  setupLogin({
    hasAccount,
    reason,
    enter: async () => {
      const acct = await loadAccount();
      state.session = makeSession(acct);
      await enterApp();
    }
  });
  setRootBuilder(() => loginView());
  render();
}

/* ---------- 退出登录 / 闲置自动退出 ----------
   连续 10 分钟没有任何操作就退出。页面在后台时定时器会被浏览器暂停，
   所以每次回到页面时按时间戳补算，而不是只靠定时器。 */
let signingOut = false;
function signOut(reason) {
  if (signingOut) return;
  signingOut = true;
  endSession();
  try {
    if (reason) sessionStorage.setItem('lifelog-logout-reason', reason);
  } catch (e) {
    /* ignore */
  }
  /* 云端退出最多等 1.5 秒：断网也必须能退出 */
  Promise.race([Promise.resolve(signOutRemote()), new Promise((r) => setTimeout(r, 1500))]).finally(() => location.reload());
}

function inApp() {
  return hasSession() && window.__appBooted && !signingOut;
}

function guardIdle() {
  if (!inApp()) return false;
  if (Date.now() - lastActiveAt() >= IDLE_LIMIT_MS) {
    signOut('idle');
    return true;
  }
  return false;
}

['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'].forEach((ev) =>
  window.addEventListener(
    ev,
    () => {
      if (!guardIdle() && hasSession()) {
        markActive();
        touchSession();
      }
    },
    { passive: true, capture: true }
  )
);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') guardIdle();
});
window.addEventListener('focus', guardIdle);
setInterval(guardIdle, 30 * 1000);
window.addEventListener('lifelog-signout', () => signOut(''));
/* 快速记消费保存后：当前页面用到账单数据的，就地刷新 */
window.addEventListener('lifelog-tx-changed', () => {
  const reload = { home: loadHome, tx: loadTx, finance: loadFinance, records: loadRecords, archive: loadRecords }[state.view];
  if (reload) reload().catch((e) => console.error('[tx-changed]', e));
});
/* 各页面要跳转时发 lifelog-go 事件（避免循环导入 main.js） */
window.addEventListener('lifelog-go', (ev) => {
  if (ev.detail) go(ev.detail);
});

/* 启动失败的兜底界面：给出原因和重试入口，绝不停在空白页 */
function showBootError(e) {
  console.error('[boot]', e);
  const msg = (e && (e.message || String(e))) || '未知错误';
  root.innerHTML = '';
  root.appendChild(
    toDom(h(
      'div',
      { class: 'boot' },
      h('div', { class: 'boot-logo' }, '我'),
      h('div', { class: 'boot-text', style: 'color:var(--red)' }, '启动没成功'),
      h('div', { class: 'muted', style: 'font-size:12px;max-width:420px;line-height:1.7;margin:6px 0 14px;text-align:center;word-break:break-all' }, msg),
      h('button', { class: 'btn btn-sm', onclick: () => location.reload() }, '再试一次')
    ))
  );
  markBooted();
}

/* h() 返回的是虚拟节点，兜底界面不经过 render()，这里直接转成真 DOM。
   （原版直接 appendChild 虚拟节点，兜底界面自己就会报错。） */
function toDom(node) {
  if (node == null || node === false) return document.createTextNode('');
  if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node));
  const el = document.createElement(node.tag);
  for (const [k, v] of Object.entries(node.props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  (node.children || []).forEach((c) => el.appendChild(toDom(c)));
  return el;
}

function markBooted() {
  window.__appBooted = true;
}

function setStatus(text) {
  try {
    const el = document.getElementById('boot-status');
    if (el) el.textContent = text;
  } catch (e) {
    /* 面板不存在就忽略 */
  }
}

window.addEventListener('error', (ev) => {
  if (window.__appBooted) return;
  showBootError(ev.error || new Error(ev.message || '脚本加载失败'));
});
window.addEventListener('unhandledrejection', (ev) => {
  if (window.__appBooted) return;
  showBootError(ev.reason || new Error('启动过程中出现未处理的错误'));
});

mountRender(root);
setStatus('JS 已加载');
boot();

/* PWA（仅 WorkBuddy 独立网站）：注册 Service Worker，加到主屏幕后全屏、断网能看到壳。
   页面一律网络优先，不会因为缓存拿到旧版。claude.ai 里不能用 Service Worker。 */
if (PLATFORM === 'workbuddy' && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        reg.update().catch(() => {});
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      })
      .catch(() => {});
  });
}
