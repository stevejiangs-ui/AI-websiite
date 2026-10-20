/* ============================================================
   应用登录：邮箱 + 密码，忘记密码用「恢复码」重设

   - 第一次打开：用邮箱 + 密码注册，同时生成一个一次性恢复码（只显示这一次）。
   - 之后每台设备打开都要用邮箱 + 密码登录；连续 10 分钟没有操作自动退出。
   - 忘记密码：输入邮箱 + 恢复码 + 新密码即可重设，重设后会发一个新的恢复码。

   为什么不是「发邮件验证码」：应用跑在 claude.ai 的沙盒里，不能联网、
   不能发信，所以用恢复码代替邮件。

   存储：密码只存 PBKDF2-SHA256 哈希（加盐，15 万次迭代），不存明文。
   云端模式存在 data/users/<你的id>/auth（私有）；本机模式存 localStorage。
   注意：这是「应用锁」，防止别人拿到你已登录的手机/电脑翻你的记录；
   数据本身没有用密码加密。
   ============================================================ */

import { backendReady, runtime } from './backend.js';
import {
  IDLE_LIMIT_MS,
  EMAIL_RE,
  normEmail,
  safeGet,
  safeSet,
  startSession as startLocalSession,
  sessionEmail,
  hasSession,
  markActive,
  lastActiveAt,
  idleExpired,
  endLocalSession,
  lockedForMs,
  noteFail,
  clearFail,
  checkLock
} from './session.js';

export { IDLE_LIMIT_MS, EMAIL_RE, hasSession, markActive, lastActiveAt, lockedForMs };

const LOCAL_KEY = 'lifelog.auth.v1';
const ITER = 150000;

/* ---------- 小工具 ---------- */

const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array((hex.match(/../g) || []).map((x) => parseInt(x, 16)));

function randomHex(n) {
  return toHex(crypto.getRandomValues(new Uint8Array(n)));
}

async function pbkdf2(secret, saltHex, iter = ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations: iter, hash: 'SHA-256' }, key, 256);
  return toHex(bits);
}

/* 常量时间比较，避免靠响应时间猜哈希 */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i += 1) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}


/* 恢复码：16 位，去掉易混字符（0/O、1/I/L），四位一组 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return chars.match(/.{4}/g).join('-');
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* ---------- 账号记录读写 ---------- */

function authDoc() {
  return runtime.db.doc('data/users/' + runtime.uid + '/auth');
}

let cached;

export async function loadAccount() {
  await backendReady();
  if (runtime.mode === 'cloud') {
    const snap = await authDoc().get();
    cached = snap.exists ? { ...snap.data() } : null;
  } else {
    try {
      cached = JSON.parse(safeGet(LOCAL_KEY) || 'null');
    } catch (e) {
      cached = null;
    }
  }
  return cached;
}

async function saveAccount(rec) {
  if (runtime.mode === 'cloud') await authDoc().set(rec);
  else safeSet(LOCAL_KEY, JSON.stringify(rec));
  cached = rec;
}

export function accountEmail() {
  return cached?.email || '';
}

/* ---------- 注册 / 登录 / 重设 ---------- */

function checkPassword(p) {
  if (String(p || '').length < 6) throw new Error('密码至少 6 位');
}

/** 首次注册。返回恢复码（只显示这一次）。 */
export async function register(email, password) {
  const e = normEmail(email);
  if (!EMAIL_RE.test(e)) throw new Error('请输入正确的邮箱地址');
  checkPassword(password);
  if (await loadAccount()) throw new Error('这个应用已经注册过账号，请直接登录');
  const salt = randomHex(16);
  const code = newRecoveryCode();
  const rsalt = randomHex(16);
  const now = new Date().toISOString();
  await saveAccount({
    v: 1,
    email: e,
    salt,
    hash: await pbkdf2(password, salt),
    rsalt,
    rhash: await pbkdf2(normCode(code), rsalt),
    iter: ITER,
    created_at: now,
    updated_at: now
  });
  startSession();
  return code;
}

/** 邮箱 + 密码登录 */
export async function login(email, password) {
  checkLock();
  const rec = cached === undefined ? await loadAccount() : cached;
  if (!rec) throw new Error('还没有注册账号');
  const e = normEmail(email);
  const hash = await pbkdf2(String(password || ''), rec.salt, rec.iter || ITER);
  if (!same(e, rec.email) || !same(hash, rec.hash)) {
    noteFail();
    throw new Error('邮箱或密码不对');
  }
  clearFail();
  startSession();
  return true;
}

/** 忘记密码：邮箱 + 恢复码 → 设新密码。返回新的恢复码（旧的作废）。 */
export async function resetWithCode(email, code, newPassword) {
  checkLock();
  checkPassword(newPassword);
  const rec = await loadAccount();
  if (!rec) throw new Error('还没有注册账号');
  const ok = same(normEmail(email), rec.email) && same(await pbkdf2(normCode(code), rec.rsalt, rec.iter || ITER), rec.rhash);
  if (!ok) {
    noteFail();
    throw new Error('邮箱或恢复码不对');
  }
  clearFail();
  const salt = randomHex(16);
  const next = newRecoveryCode();
  const rsalt = randomHex(16);
  await saveAccount({
    ...rec,
    salt,
    hash: await pbkdf2(newPassword, salt),
    rsalt,
    rhash: await pbkdf2(normCode(next), rsalt),
    iter: ITER,
    updated_at: new Date().toISOString()
  });
  startSession();
  return next;
}

/* ---------- 邮箱验证码找回 ----------
   6 位数字，10 分钟有效，最多试 5 次，60 秒内不能重发。
   验证码只存哈希；发信失败会撤销这次验证码。 */

const OTP_TTL = 10 * 60 * 1000;
const OTP_COOLDOWN = 60 * 1000;
const OTP_TRIES = 5;

export function resendWaitMs() {
  const sent = cached?.otp?.sent_at || 0;
  return Math.max(0, sent + OTP_COOLDOWN - Date.now());
}

/** 生成验证码并用 send(email, code) 发出去。返回实际发往的邮箱。 */
export async function requestEmailCode(email, send) {
  checkLock();
  const rec = await loadAccount();
  if (!rec) throw new Error('还没有注册账号');
  if (!same(normEmail(email), rec.email)) {
    noteFail();
    throw new Error('这不是注册时用的邮箱');
  }
  const wait = resendWaitMs();
  if (wait > 0) throw new Error(`请 ${Math.ceil(wait / 1000)} 秒后再重新发送`);
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  const code = String(n).padStart(6, '0');
  const salt = randomHex(16);
  const otp = { salt, hash: await pbkdf2(code, salt, 20000), exp: Date.now() + OTP_TTL, tries: 0, sent_at: Date.now() };
  await saveAccount({ ...rec, otp });
  try {
    await send(rec.email, code);
  } catch (e) {
    const { otp: _drop, ...rest } = cached;
    await saveAccount(rest).catch(() => {});
    throw e;
  }
  return rec.email;
}

/** 邮箱 + 验证码 + 新密码 → 重设并登录 */
export async function resetWithEmailCode(email, code, newPassword) {
  checkLock();
  checkPassword(newPassword);
  const rec = await loadAccount();
  if (!rec) throw new Error('还没有注册账号');
  if (!same(normEmail(email), rec.email)) throw new Error('这不是注册时用的邮箱');
  const otp = rec.otp;
  if (!otp) throw new Error('请先点「发送验证码」');
  if (Date.now() > otp.exp) throw new Error('验证码已过期，请重新发送');
  if (otp.tries >= OTP_TRIES) throw new Error('验证码输错太多次已失效，请重新发送');
  const clean = String(code || '').replace(/\D/g, '');
  if (!same(await pbkdf2(clean, otp.salt, 20000), otp.hash)) {
    noteFail();
    await saveAccount({ ...rec, otp: { ...otp, tries: otp.tries + 1 } });
    const left = OTP_TRIES - otp.tries - 1;
    throw new Error(left > 0 ? `验证码不对，还能再试 ${left} 次` : '验证码输错太多次已失效，请重新发送');
  }
  clearFail();
  const salt = randomHex(16);
  const { otp: _used, ...rest } = rec;
  await saveAccount({ ...rest, salt, hash: await pbkdf2(newPassword, salt), iter: ITER, updated_at: new Date().toISOString() });
  startSession();
}

/** 已登录状态下改密码（要验证旧密码） */
export async function changePassword(oldPassword, newPassword) {
  checkLock();
  checkPassword(newPassword);
  const rec = await loadAccount();
  if (!rec || !same(await pbkdf2(String(oldPassword || ''), rec.salt, rec.iter || ITER), rec.hash)) {
    noteFail();
    throw new Error('当前密码不对');
  }
  clearFail();
  const salt = randomHex(16);
  await saveAccount({ ...rec, salt, hash: await pbkdf2(newPassword, salt), iter: ITER, updated_at: new Date().toISOString() });
}

/** 改登录邮箱（要验证密码） */
export async function changeEmail(password, newEmail) {
  const e = normEmail(newEmail);
  if (!EMAIL_RE.test(e)) throw new Error('请输入正确的邮箱地址');
  checkLock();
  const rec = await loadAccount();
  if (!rec || !same(await pbkdf2(String(password || ''), rec.salt, rec.iter || ITER), rec.hash)) {
    noteFail();
    throw new Error('密码不对');
  }
  clearFail();
  await saveAccount({ ...rec, email: e, updated_at: new Date().toISOString() });
}

/** 重新生成恢复码（要验证密码）。旧码作废。 */
export async function regenerateRecovery(password) {
  checkLock();
  const rec = await loadAccount();
  if (!rec || !same(await pbkdf2(String(password || ''), rec.salt, rec.iter || ITER), rec.hash)) {
    noteFail();
    throw new Error('密码不对');
  }
  clearFail();
  const code = newRecoveryCode();
  const rsalt = randomHex(16);
  await saveAccount({ ...rec, rsalt, rhash: await pbkdf2(normCode(code), rsalt), updated_at: new Date().toISOString() });
  return code;
}

/* ---------- 会话（只在这台设备、这个浏览器有效） ---------- */

function startSession() {
  startLocalSession(cached?.email || '');
}

/** 本机是否有有效会话：登录过、账号邮箱没变、没有超过 10 分钟不操作 */
export function sessionValid() {
  if (!hasSession() || !cached || sessionEmail() !== cached.email) return false;
  return !idleExpired();
}

export function endSession() {
  endLocalSession();
}
