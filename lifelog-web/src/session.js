/* 本机登录会话与闲置计时（两个平台共用）
   - 会话记在 localStorage：只在这台设备、这个浏览器有效
   - 连续 10 分钟没有操作就算过期（回到页面时按时间戳补算）
   - 输错限流：连错 5 次锁 30 秒，之后翻倍，最长 15 分钟 */

const SESSION_KEY = 'lifelog.session.v1';
const ACTIVE_KEY = 'lifelog.active.v1';
const FAIL_KEY = 'lifelog.authfail.v1';
const LAST_EMAIL_KEY = 'lifelog.lastemail.v1';

export const IDLE_LIMIT_MS = 10 * 60 * 1000;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normEmail = (e) => String(e || '').trim().toLowerCase();

export function safeGet(k) {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
export function safeSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch (e) {
    /* 无痕模式等：退化为本次打开有效 */
  }
}
export function safeDel(k) {
  try {
    localStorage.removeItem(k);
  } catch (e) {
    /* ignore */
  }
}

export function startSession(email) {
  const now = Date.now();
  safeSet(SESSION_KEY, JSON.stringify({ email: email || '', at: now }));
  safeSet(ACTIVE_KEY, String(now));
  if (email) safeSet(LAST_EMAIL_KEY, email);
}

export function sessionEmail() {
  try {
    return JSON.parse(safeGet(SESSION_KEY) || 'null')?.email || '';
  } catch (e) {
    return '';
  }
}

export function lastEmail() {
  return safeGet(LAST_EMAIL_KEY) || '';
}

export function hasSession() {
  return !!safeGet(SESSION_KEY);
}

export function markActive() {
  if (hasSession()) safeSet(ACTIVE_KEY, String(Date.now()));
}

export function lastActiveAt() {
  return Number(safeGet(ACTIVE_KEY) || 0) || 0;
}

export function idleExpired() {
  return Date.now() - lastActiveAt() >= IDLE_LIMIT_MS;
}

export function endLocalSession() {
  safeDel(SESSION_KEY);
  safeDel(ACTIVE_KEY);
}

/* ---------- 输错限流 ---------- */

function failState() {
  try {
    return JSON.parse(safeGet(FAIL_KEY) || '{"n":0,"until":0}');
  } catch (e) {
    return { n: 0, until: 0 };
  }
}

export function lockedForMs() {
  return Math.max(0, failState().until - Date.now());
}

export function noteFail() {
  const f = failState();
  f.n += 1;
  if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60 * 1000, 30000 * 2 ** (f.n - 5));
  safeSet(FAIL_KEY, JSON.stringify(f));
}

export function clearFail() {
  safeDel(FAIL_KEY);
}

export function checkLock() {
  const ms = lockedForMs();
  if (ms > 0) throw new Error(`输错次数太多，请 ${Math.ceil(ms / 1000)} 秒后再试`);
}
