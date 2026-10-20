/* 发邮件：通过你在 claude.ai 连接的 Gmail，从你自己的 Gmail 账号发出。
   只用来发「找回密码验证码」。第一次发送时 claude.ai 会请你确认允许。 */
import { backendReady, runtime } from './backend.js';

const MAIL_ERR = {
  server_not_connected: 'Gmail 还没连接：请在 claude.ai「设置 → 连接器」里连接 Gmail',
  needs_reauth: 'Gmail 授权过期了：请在 claude.ai「设置 → 连接器」里重新连接 Gmail',
  not_in_manifest: '你没有允许这个应用使用 Gmail（可在页面权限里重新打开）',
  approval_required: '需要你在弹窗里点「允许」才能发送',
  blocked_by_policy: '你的组织策略不允许使用 Gmail 发信',
  server_unavailable: 'Gmail 暂时连不上，请稍后再试',
  selection_required: '你连接了多个 Gmail，请先在弹窗里选一个'
};

export async function canSendMail() {
  await backendReady();
  return !!runtime.mcp;
}

/** 发送验证码邮件 */
export async function sendCodeEmail(to, code) {
  await backendReady();
  if (!runtime.mcp) throw new Error('邮件发送只在 claude.ai 里打开时可用；也可以改用「恢复码」重设');
  const subject = `个人APP 找回密码验证码：${code}`;
  const body =
    `你的验证码是：${code}\n\n` +
    `10 分钟内有效，只能用一次。\n` +
    `如果不是你本人在找回密码，请忽略这封邮件，你的账号不会有任何变化。\n\n— 个人APP`;
  const htmlBody =
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;max-width:420px;padding:8px 0;color:#23211d">' +
    '<p style="margin:0 0 12px;font-size:14px">你正在找回「个人APP」的登录密码，验证码是：</p>' +
    `<p style="margin:0 0 16px;font-size:30px;letter-spacing:6px;font-weight:600;color:#b4552f">${code}</p>` +
    '<p style="margin:0 0 6px;font-size:13px;color:#5c5852">10 分钟内有效，只能用一次。</p>' +
    '<p style="margin:0;font-size:12px;color:#9a958c">如果不是你本人在找回密码，请忽略这封邮件，你的账号不会有任何变化。</p>' +
    '</div>';
  try {
    await runtime.mcp.callTool('Gmail', 'send_message', { to: [to], subject, body, htmlBody }, { cache: false });
  } catch (e) {
    const err = new Error((e && MAIL_ERR[e.code]) || '验证码邮件没发出去：' + ((e && e.message) || '未知错误'));
    err.code = e && e.code;
    throw err;
  }
}
