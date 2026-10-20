/* 测试用：模拟 @tencent-ai/workbuddy-cloud-sdk 的接口形状
   （auth.signInWithPassword / getSession / signOut / resetPasswordForEmail / resetPasswordForOld，
     database.from(...)，llm.models.list / chat.completions.create）。
   数据库复用 backend.js 的查询引擎（本机 localStorage 模式）。 */
import { cloud as local } from '../src/backend.js';

const UKEY = 'wbmock.users';
const SKEY = 'wbmock.session';
const get = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch (e) {
    return d;
  }
};
const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
if (!localStorage.getItem(UKEY)) put(UKEY, { 'test.user@example.com': 'secret123' });

window.__wbMail = [];
const sessionFor = (email) => ({ accessToken: 'tok-' + Date.now(), user: { id: 'u_wb_1', email, name: '测试用户' } });

export function createWorkBuddyCloud() {
  return {
    database: local.database,
    auth: {
      async getSession() {
        return { data: get(SKEY, null), error: null };
      },
      async signInWithPassword({ email, password }) {
        await new Promise((r) => setTimeout(r, 80));
        const users = get(UKEY, {});
        if (users[email] !== password) return { data: null, error: { message: 'invalid_username_or_password' } };
        const s = sessionFor(email);
        put(SKEY, s);
        return { data: s, error: null };
      },
      async signOut() {
        localStorage.removeItem(SKEY);
        return { error: null };
      },
      async resetPasswordForEmail(email) {
        await new Promise((r) => setTimeout(r, 80));
        const users = get(UKEY, {});
        if (!users[email]) return { data: null, error: { message: 'user not found' } };
        const code = String(Math.floor(100000 + Math.random() * 900000));
        window.__wbMail.push({ email, code });
        return {
          data: {
            async updateUser({ nonce, password }) {
              if (nonce !== code) return { data: null, error: { message: 'invalid verification code' } };
              const u = get(UKEY, {});
              u[email] = password;
              put(UKEY, u);
              const s = sessionFor(email);
              put(SKEY, s);
              return { data: s, error: null };
            }
          },
          error: null
        };
      },
      async resetPasswordForOld({ oldPassword, newPassword }) {
        const s = get(SKEY, null);
        const u = get(UKEY, {});
        if (!s || u[s.user.email] !== oldPassword) return { error: { message: 'invalid password' } };
        u[s.user.email] = newPassword;
        put(UKEY, u);
        return { error: null };
      }
    },
    llm: {
      models: {
        async list() {
          return [{ id: 'glm-5.3' }, { id: 'glm-4.7' }];
        }
      },
      chat: {
        completions: {
          async *create({ model, messages }) {
            window.__wbLLM = (window.__wbLLM || []).concat(model);
            const all = JSON.stringify(messages);
            const text = /summary/.test(all)
              ? '{"summary":"今天去了公司，晚上吃了兰州拉面。","points":["上班"],"topics":["工作"],"mood":"calm","todos":[],"people":[],"money":"","title":""}'
              : '这是模拟的国产模型回答（' + model + '）';
            for (const part of [text.slice(0, 5), text.slice(5)]) {
              await new Promise((r) => setTimeout(r, 30));
              yield { choices: [{ delta: { content: part } }] };
            }
          }
        }
      }
    }
  };
}
