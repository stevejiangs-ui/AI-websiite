/* 平台：WorkBuddy（腾讯，国内可直接访问）
   - 数据：WorkBuddy 云数据库（就是原来那个库，老数据都在）
   - 登录：WorkBuddy 账号的邮箱 + 密码；忘记密码由 WorkBuddy 发邮箱验证码
   - AI：WorkBuddy 提供的国产模型（GLM / Kimi / DeepSeek 等）
   构建：npm run build:wb（Vite）→ dist/，再同步到 web/ 发布 */
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk';
import { publicConfig } from './publicConfig.js';
import { ALL_TABLES } from './tables.js';
import {
  IDLE_LIMIT_MS,
  EMAIL_RE,
  normEmail,
  startSession,
  hasSession,
  markActive,
  lastActiveAt,
  idleExpired,
  endLocalSession,
  lastEmail,
  sessionEmail,
  lockedForMs
} from './session.js';

export const PLATFORM = 'workbuddy';
export const PLATFORM_LABEL = 'WorkBuddy';
export { ALL_TABLES, IDLE_LIMIT_MS, EMAIL_RE, hasSession, markActive, lastActiveAt, lockedForMs };

export const cloud = createWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
  publishableKey: publicConfig.publishableKey
});

export const runtime = {
  mode: 'cloud',
  uid: null,
  name: '',
  email: '',
  db: null,
  sample: null,
  downloads: null, // 普通网页，下载直接走浏览器
  mcp: null,
  aiAvailable: true,
  isOwner: true
};

let sdkSession = null;

function applySession(s) {
  sdkSession = s || null;
  const u = (s && s.user) || {};
  runtime.uid = u.id || null;
  runtime.email = u.email || '';
  runtime.name = u.name || u.user_metadata?.name || '';
}

/* 启动时读一次 SDK 自己保存的会话（存在本机），不发网络请求以外的东西 */
let readyPromise = null;
export function backendReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        const r = await cloud.auth.getSession();
        applySession(r?.data || null);
      } catch (e) {
        applySession(null);
      }
      return runtime;
    })();
  }
  return readyPromise;
}

/* 数据直接读写云端，没有本地表缓存，不需要作废 */
export function invalidateAll() {}

/** 从 JSON 备份恢复：按 id 覆盖写回（同一条不会重复） */
export async function restoreTables(dataByTable, onProgress) {
  const report = {};
  for (const table of Object.keys(dataByTable)) {
    if (!ALL_TABLES.includes(table)) continue;
    const rows = (dataByTable[table] || []).filter((r) => r && typeof r === 'object');
    if (!rows.length) continue;
    const payload = rows.map((r) => ({ ...r, owner_id: runtime.uid }));
    for (let i = 0; i < payload.length; i += 200) {
      const chunk = payload.slice(i, i + 200);
      const { error } = await cloud.database.from(table).upsert(chunk, { onConflict: 'id' }).select('id');
      if (error) throw error;
      if (onProgress) onProgress(table, Math.min(i + 200, payload.length));
    }
    report[table] = payload.length;
  }
  return report;
}

/* ---------------- 登录 ---------------- */

export const authFeatures = {
  register: false, // 账号由 WorkBuddy 管理，用原来的邮箱和密码登录
  recoveryCode: false,
  emailReset: true, // WorkBuddy 发邮箱验证码
  changeEmail: false // WorkBuddy 不支持换绑邮箱
};

/** 登录页预填的邮箱：上次登录用的 */
export async function loadAccount() {
  await backendReady();
  return { email: runtime.email || lastEmail() };
}

export function accountEmail() {
  return runtime.email || lastEmail();
}

/** 有效会话：SDK 有会话 + 本机登录记录 + 没有闲置超时 */
export function sessionValid() {
  if (!sdkSession || !hasSession()) return false;
  const se = sessionEmail();
  if (se && runtime.email && se !== normEmail(runtime.email)) return false;
  return !idleExpired();
}

function authErr(e, fallback) {
  const msg = (e && (e.message || e.error_description || e.msg)) || String(e || '');
  if (/账号或密码|密码错误|invalid_username_or_password|invalid login|credentials/i.test(msg)) return new Error('邮箱或密码不对');
  if (/invalid_grant|another client/i.test(msg)) return new Error('这个账号已在别处登录，先在原设备退出再试');
  if (/rate|频繁|too many/i.test(msg)) return new Error('操作太频繁，请等一分钟再试');
  if (/network|fetch|Failed to fetch/i.test(msg)) return new Error('网络连不上，请检查网络后重试');
  return new Error((fallback ? fallback + '：' : '') + msg);
}

export async function login(email, password) {
  const e = normEmail(email);
  if (!EMAIL_RE.test(e)) throw new Error('请输入正确的邮箱地址');
  if (!password) throw new Error('请输入密码');
  let res;
  try {
    res = await cloud.auth.signInWithPassword({ email: e, password });
  } catch (err) {
    throw authErr(err, '登录失败');
  }
  if (res?.error) throw authErr(res.error, '登录失败');
  applySession(res.data);
  if (!runtime.email) runtime.email = e;
  startSession(normEmail(runtime.email));
  return true;
}

export async function register() {
  throw new Error('账号由 WorkBuddy 管理，请用原来的邮箱和密码登录');
}

export async function resetWithCode() {
  throw new Error('请使用邮箱验证码找回密码');
}

export async function regenerateRecovery() {
  throw new Error('WorkBuddy 版没有恢复码，忘记密码请用邮箱验证码');
}

export async function changeEmail() {
  throw new Error('WorkBuddy 不支持更换登录邮箱');
}

/* 找回密码：WorkBuddy 给邮箱发验证码，返回一个 challenge，
   challenge.updateUser({ nonce: 验证码, password: 新密码 }) 才真正改密码。 */
let challenge = null;
let challengeEmail = '';
let sentAt = 0;
const COOLDOWN = 60 * 1000;

export function resendWaitMs() {
  return Math.max(0, sentAt + COOLDOWN - Date.now());
}

export async function requestEmailCode(email) {
  const e = normEmail(email);
  if (!EMAIL_RE.test(e)) throw new Error('请输入正确的邮箱地址');
  const wait = resendWaitMs();
  if (wait > 0) throw new Error(`请 ${Math.ceil(wait / 1000)} 秒后再重新发送`);
  let res;
  try {
    res = await cloud.auth.resetPasswordForEmail(e);
  } catch (err) {
    throw authErr(err, '验证码没发出去');
  }
  if (res?.error) throw authErr(res.error, '验证码没发出去');
  if (!res?.data || typeof res.data.updateUser !== 'function') throw new Error('服务端没有返回重置凭据，请稍后再试');
  challenge = res.data;
  challengeEmail = e;
  sentAt = Date.now();
  return e;
}

export async function resetWithEmailCode(email, code, newPassword) {
  if (String(newPassword || '').length < 6) throw new Error('新密码至少 6 位');
  const e = normEmail(email);
  if (!challenge || e !== challengeEmail) throw new Error('请先点「发送验证码」');
  let res;
  try {
    res = await challenge.updateUser({ nonce: String(code || '').trim(), password: newPassword });
  } catch (err) {
    res = { error: err };
  }
  if (res?.error) {
    const msg = String(res.error.message || res.error);
    /* 密码其实已经改好，只是自动登录被拒：用新密码登一次 */
    if (!/invalid_grant|another client/i.test(msg)) {
      if (/验证码|code|nonce|expired|失效|invalid/i.test(msg)) throw new Error('验证码不对或已经过期，请重新发送');
      throw authErr(res.error, '重置失败');
    }
  }
  challenge = null;
  if (res?.data?.accessToken || res?.data?.user) {
    applySession(res.data);
    if (!runtime.email) runtime.email = e;
    startSession(normEmail(runtime.email));
    return;
  }
  await login(e, newPassword);
}

export async function changePassword(oldPassword, newPassword) {
  if (String(newPassword || '').length < 6) throw new Error('新密码至少 6 位');
  let res;
  try {
    res = await cloud.auth.resetPasswordForOld({ oldPassword, newPassword });
  } catch (err) {
    res = { error: err };
  }
  if (res?.error) {
    const msg = String(res.error.message || res.error);
    throw new Error(/密码|password|credential|invalid/i.test(msg) ? '当前密码不对' : '保存失败：' + msg);
  }
}

/** 有操作时顺手续期 SDK 会话（最多 4 分钟一次），避免「人还在用，token 却过期了」 */
let lastTouch = 0;
export async function touchSession() {
  if (!sdkSession || Date.now() - lastTouch < 4 * 60 * 1000) return;
  lastTouch = Date.now();
  try {
    const r = await cloud.auth.getSession();
    if (r?.data) applySession(r.data);
  } catch (e) {
    /* 网络抖动不处理，下次数据请求会给出「登录已失效」 */
  }
}

export function endSession() {
  endLocalSession();
}

/** 退出：云端销毁会话（失败也不阻塞本地退出） */
export async function signOutRemote() {
  try {
    await cloud.auth.signOut();
  } catch (e) {
    /* ignore */
  }
}
