/* 平台：claude.ai（数据存 claude.ai 应用数据库，AI 用 Claude，验证码经 Gmail 发信）
   构建：node build.mjs   →  dist/个人APP.html / dist/artifact.html */
import * as auth from './auth.js';
import { sendCodeEmail } from './mailer.js';

export const PLATFORM = 'claude';
export const PLATFORM_LABEL = 'claude.ai';

export { cloud, runtime, backendReady, invalidateAll, restoreTables, ALL_TABLES } from './backend.js';

export const authFeatures = {
  register: true, // 首次打开在应用里注册
  recoveryCode: true, // 恢复码备用
  emailReset: true, // 邮箱验证码（Gmail 连接器）
  changeEmail: true
};

export const {
  IDLE_LIMIT_MS,
  EMAIL_RE,
  loadAccount,
  sessionValid,
  hasSession,
  markActive,
  endSession,
  lastActiveAt,
  lockedForMs,
  accountEmail,
  register,
  login,
  resetWithCode,
  resetWithEmailCode,
  resendWaitMs,
  changePassword,
  changeEmail,
  regenerateRecovery
} = auth;

export function requestEmailCode(email) {
  return auth.requestEmailCode(email, sendCodeEmail);
}

/* claude.ai 的登录由宿主维持，不需要续期 */
export async function touchSession() {}

export function signOutRemote() {}
