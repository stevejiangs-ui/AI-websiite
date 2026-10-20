/* 登录界面：注册（首次）/ 登录 / 忘记密码（恢复码）/ 显示恢复码 */
import { h, render, toast } from './store.js';
import { register, login, resetWithCode, accountEmail, lockedForMs, EMAIL_RE, IDLE_LIMIT_MS } from './auth.js';

let ls = {
  mode: 'login', // register | login | recover | code
  email: '',
  password: '',
  password2: '',
  code: '',
  busy: false,
  err: '',
  hint: '',
  newCode: '',
  saved: false
};

let onEnter = () => {};

export function setupLogin({ hasAccount, reason, enter }) {
  onEnter = enter;
  ls = { ...ls, mode: hasAccount ? 'login' : 'register', email: hasAccount ? accountEmail() : '', err: '', busy: false };
  ls.hint = reason === 'idle' ? `已经 ${IDLE_LIMIT_MS / 60000} 分钟没有操作，为安全起见自动退出了，重新输入密码就能进。` : '';
}

function set(patch) {
  Object.assign(ls, patch);
  render();
}

function input(id, label, key, opts = {}) {
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id }, label),
    h('input', {
      class: 'input',
      id,
      type: opts.type || 'text',
      placeholder: opts.placeholder || '',
      autocomplete: opts.autocomplete || 'off',
      inputmode: opts.inputmode || null,
      autocapitalize: opts.autocapitalize || null,
      value: ls[key],
      oninput: (ev) => {
        ls[key] = ev.target.value;
        ls.err = '';
      },
      onkeydown: (ev) => {
        if (ev.key === 'Enter') submit();
      }
    })
  );
}

async function run(fn) {
  if (ls.busy) return;
  set({ busy: true, err: '' });
  try {
    await fn();
  } catch (e) {
    ls.err = (e && e.message) || String(e);
  }
  ls.busy = false;
  render();
}

function submit() {
  if (ls.mode === 'register') return doRegister();
  if (ls.mode === 'login') return doLogin();
  if (ls.mode === 'recover') return doRecover();
  return null;
}

function doRegister() {
  return run(async () => {
    if (!EMAIL_RE.test(ls.email.trim())) throw new Error('请输入正确的邮箱地址');
    if (ls.password.length < 6) throw new Error('密码至少 6 位');
    if (ls.password !== ls.password2) throw new Error('两次输入的密码不一致');
    const code = await register(ls.email, ls.password);
    ls.password = ls.password2 = '';
    ls.newCode = code;
    ls.saved = false;
    ls.mode = 'code';
  });
}

function doLogin() {
  return run(async () => {
    if (!ls.password) throw new Error('请输入密码');
    await login(ls.email, ls.password);
    ls.password = '';
    onEnter();
  });
}

function doRecover() {
  return run(async () => {
    if (!ls.code.trim()) throw new Error('请输入恢复码');
    if (ls.password.length < 6) throw new Error('新密码至少 6 位');
    if (ls.password !== ls.password2) throw new Error('两次输入的新密码不一致');
    const next = await resetWithCode(ls.email, ls.code, ls.password);
    ls.password = ls.password2 = ls.code = '';
    ls.newCode = next;
    ls.saved = false;
    ls.mode = 'code';
    toast('密码已重设');
  });
}

function errBox() {
  const lock = lockedForMs();
  return h('div', { class: 'err' }, ls.err || (lock ? `输错次数太多，请 ${Math.ceil(lock / 1000)} 秒后再试` : ''));
}

function primary(label) {
  return h(
    'button',
    { class: 'btn btn-accent btn-block', style: 'margin-top:14px', disabled: ls.busy, onclick: submit },
    ls.busy ? h('span', { class: 'spinner' }) : label
  );
}

function registerCard() {
  return h(
    'div',
    { class: 'login-card' },
    h('h2', {}, '创建账号'),
    h('p', { class: 'sub' }, '第一次使用：设置登录邮箱和密码'),
    input('reg-email', '邮箱', 'email', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off' }),
    input('reg-pass', '密码', 'password', { type: 'password', placeholder: '至少 6 位', autocomplete: 'new-password' }),
    input('reg-pass2', '确认密码', 'password2', { type: 'password', placeholder: '再输入一次', autocomplete: 'new-password' }),
    errBox(),
    primary('创建并进入'),
    h('p', { class: 'hint' }, '创建后会给你一个恢复码，忘记密码时用它重设。请务必保存好。')
  );
}

function loginCard() {
  return h(
    'div',
    { class: 'login-card' },
    h('h2', {}, '登录'),
    h('p', { class: 'sub' }, '使用邮箱和密码登录'),
    ls.hint ? h('div', { class: 'ok-msg' }, ls.hint) : null,
    input('login-email', '邮箱', 'email', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off' }),
    input('login-pass', '密码', 'password', { type: 'password', placeholder: '登录密码', autocomplete: 'current-password' }),
    h(
      'div',
      { class: 'row-between', style: 'margin-top:2px' },
      h('span', { class: 'muted', style: 'font-size:11.5px' }, `${IDLE_LIMIT_MS / 60000} 分钟没有操作会自动退出`),
      h('button', { class: 'link', style: 'font-size:12.5px', onclick: () => set({ mode: 'recover', err: '', password: '', password2: '', code: '' }) }, '忘记密码？')
    ),
    errBox(),
    primary('登录')
  );
}

function recoverCard() {
  return h(
    'div',
    { class: 'login-card' },
    h('h2', {}, '重设密码'),
    h('p', { class: 'sub' }, '用注册时保存的恢复码设一个新密码'),
    input('rec-email', '邮箱', 'email', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off' }),
    input('rec-code', '恢复码', 'code', { placeholder: 'XXXX-XXXX-XXXX-XXXX', autocapitalize: 'characters' }),
    input('rec-pass', '新密码', 'password', { type: 'password', placeholder: '至少 6 位', autocomplete: 'new-password' }),
    input('rec-pass2', '确认新密码', 'password2', { type: 'password', placeholder: '再输入一次', autocomplete: 'new-password' }),
    errBox(),
    primary('重设密码并登录'),
    h(
      'p',
      { class: 'hint' },
      '这个应用运行在 claude.ai 里，不能发邮件，所以用恢复码代替邮箱验证码。恢复码也丢了的话，可以在 Claude 里让我帮你清除登录设置（数据不会丢）。'
    ),
    h('button', { class: 'link', style: 'font-size:12px;margin-top:10px', onclick: () => set({ mode: 'login', err: '', password: '', password2: '' }) }, '← 返回登录')
  );
}

function codeCard() {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ls.newCode);
      toast('恢复码已复制');
    } catch (e) {
      const el = document.getElementById('recovery-code');
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      toast('请长按选中后复制', 'err');
    }
  };
  return h(
    'div',
    { class: 'login-card' },
    h('h2', {}, '保存你的恢复码'),
    h('p', { class: 'sub' }, '忘记密码时，用它重设密码。它只显示这一次。'),
    h('div', { class: 'recovery-code', id: 'recovery-code' }, ls.newCode),
    h('button', { class: 'btn btn-sm btn-ghost', style: 'margin-top:10px', onclick: copy }, '复制恢复码'),
    h(
      'p',
      { class: 'hint', style: 'margin-top:12px' },
      '建议存进手机备忘录或密码管理器，或者截图。重设密码后会换一个新的恢复码，旧的作废。'
    ),
    h(
      'label',
      { class: 'row', style: 'gap:8px;margin-top:12px;font-size:13px;cursor:pointer' },
      h('input', {
        type: 'checkbox',
        id: 'code-saved',
        checked: ls.saved,
        onchange: (ev) => set({ saved: ev.target.checked })
      }),
      '我已经保存好恢复码'
    ),
    h(
      'button',
      {
        class: 'btn btn-accent btn-block',
        style: 'margin-top:14px',
        disabled: !ls.saved,
        onclick: () => {
          ls.newCode = '';
          onEnter();
        }
      },
      '进入应用'
    )
  );
}

export function loginView() {
  const card = ls.mode === 'register' ? registerCard() : ls.mode === 'recover' ? recoverCard() : ls.mode === 'code' ? codeCard() : loginCard();
  return h(
    'div',
    { class: 'login-wrap' },
    h(
      'div',
      { class: 'login-art' },
      h('div', {}, h('h1', {}, '把日子记下来，\n钱自然会说话。'), h('p', {}, '日记、账单、目标、圈子和八字命理，一个地方全都有。')),
      h('div', { class: 'login-feats' })
    ),
    h('div', { class: 'login-panel' }, card)
  );
}
