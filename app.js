// Papo Flash — conversas e espaços em tempo real.
import * as api from './backend.js';
import { initCalls } from './calls.js';

// ================================================================= utilidades
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ONLINE_MS = 5 * 60 * 1000;
const TYPING_MS = 8000;
const MAX_LEN = 4000;
const EMOJIS = '😀 😂 🥹 😍 😎 🤔 😮 😢 😡 🥳 😴 🤯 👍 👎 👏 🙏 💪 🙌 👀 🔥 ❤️ 💜 💙 💚 ⭐ ✨ 🎉 🎂 ✅ ❌ ❓ 💡 📚 ✏️ 🎮 ⚽ 🍕 🍫 ☕ 🐶 🐱 🌈 ☀️ 🌙 🚀 ⚡ 💬 📌'.split(' ');
const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
const SPACE_EMOJIS = '💬 📚 🎮 ⚽ 🎨 🎵 🍕 🚀 ⚡ 🌈 🐱 🧪 📐 🌎 💡 🏆'.split(' ');

function formatText(raw) {
  let t = esc(raw);
  // links
  t = t.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  // `código`, *negrito*, _itálico_, ~riscado~ (como no Google Chat)
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<strong>$2</strong>');
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  t = t.replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/g, '$1<s>$2</s>');
  return t.replace(/\n/g, '<br>');
}
const onlyEmoji = (s) => /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s){1,12}$/u.test(s) && !/^[\d\s#*]+$/.test(s);

function timeOf(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Hoje';
  if (same(d, y)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function shortWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (d.toDateString() === new Date().toDateString()) return timeOf(ms);
  if (Date.now() - ms < 6 * 86400000) return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function lastSeen(ms) {
  if (!ms) return 'Off-line';
  if (Date.now() - ms < ONLINE_MS) return 'Ativo agora';
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `Visto há ${min} min`;
  if (min < 24 * 60) return `Visto há ${Math.round(min / 60)} h`;
  return `Visto em ${new Date(ms).toLocaleDateString('pt-BR')}`;
}

function toast(msg, kind = 'info', time = 3200) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, time);
}

function errText(err) {
  if (!err) return 'Algo deu errado. Tente de novo.';
  if (err.code === 'permission-denied') return 'Você não tem permissão para fazer isso.';
  if (err.code === 'unavailable') return 'Sem internet no momento. Vai enviar quando voltar.';
  return err.message || 'Algo deu errado. Tente de novo.';
}

// janelinha (modal) simples
function dialog({ title, body, actions = [], onOpen }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="icon-btn" data-x aria-label="Fechar">✕</button></header>
    <div class="modal-body">${body}</div>
    <footer>${actions.map((a, i) => `<button class="btn ${a.kind || ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}</footer></div>`;
  document.body.appendChild(wrap);
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('[data-x]')) return close();
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = actions[Number(b.dataset.a)];
    if (!a.onClick) return close();
    b.disabled = true;
    try {
      const keep = await a.onClick(wrap, close);
      if (keep !== true) close();
    } catch (err) {
      const box = $('.modal-error', wrap);
      if (box) {
        box.textContent = errText(err);
        box.hidden = false;
      } else toast(errText(err), 'error');
    }
    b.disabled = false;
  });
  wrap.querySelector('form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    wrap.querySelector('footer .btn.primary')?.click();
  });
  setTimeout(() => (wrap.querySelector('input, textarea, select') || wrap.querySelector('footer .btn.primary'))?.focus(), 30);
  if (onOpen) onOpen(wrap, close);
  return { el: wrap, close };
}

function confirmBox(title, text, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const d = dialog({
      title,
      body: `<p>${esc(text)}</p>`,
      actions: [
        { label: 'Cancelar', kind: 'ghost' },
        {
          label: okLabel,
          kind: danger ? 'danger' : 'primary',
          onClick: () => {
            done = true;
            resolve(true);
          },
        },
      ],
    });
    const obs = new MutationObserver(() => {
      if (!document.body.contains(d.el)) {
        obs.disconnect();
        if (!done) resolve(false);
      }
    });
    obs.observe(document.body, { childList: true });
  });
}

// som curtinho de mensagem nova
let audioCtx = null;
function ding() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.32);
  } catch (_) {
    /* sem som */
  }
}

// tema claro/escuro
function applyTheme() {
  let t = null;
  try {
    t = localStorage.getItem('pf_tema');
  } catch (_) {
    t = null;
  }
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme();

// ================================================================= app no celular
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isPhone = () => matchMedia('(max-width: 900px), (hover: none)').matches;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (S.me) scheduleRender();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('App instalado! Procure o ⚡ Papo Flash na tela do celular.', 'ok');
  if (S.me) scheduleRender();
});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
function canOfferInstall() {
  return !isStandalone() && (installPrompt || isIOS() || isPhone());
}
async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    try {
      await installPrompt.userChoice;
    } catch (_) {
      /* ok */
    }
    installPrompt = null;
    scheduleRender();
    return;
  }
  const ios = isIOS();
  dialog({
    title: 'Instalar o Papo Flash',
    body: ios
      ? `<ol class="install-steps"><li>Abra este site no <b>Safari</b>.</li><li>Toque no botão <b>Compartilhar</b> (o quadrado com a setinha ⬆️).</li><li>Role e toque em <b>Adicionar à Tela de Início</b>.</li><li>Toque em <b>Adicionar</b>.</li></ol>`
      : `<ol class="install-steps"><li>Abra este site no <b>Chrome</b>.</li><li>Toque nos <b>três pontinhos ⋮</b> lá em cima.</li><li>Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li><li>Confirme em <b>Instalar</b>.</li></ol>`,
    actions: [{ label: 'Entendi', kind: 'primary' }],
  });
}

// ================================================================= estado
const S = {
  me: null, // { uid, name, email, photo }
  myProfile: null,
  convos: [],
  convosLoaded: false,
  profiles: new Map(), // uid -> perfil
  profileSubs: new Map(), // uid -> unsubscribe
  current: null, // id da conversa aberta
  messages: [],
  hasMore: false,
  older: [],
  msgUnsub: null,
  replyTo: null,
  editing: null,
  search: '',
  showMembers: false,
  lastSeenAt: new Map(), // cid -> lastMessageAt já visto (para avisos)
  startedAt: Date.now(),
  typingSentAt: 0,
  typingTimer: null,
  uploads: [], // arquivos sendo enviados
  recording: null, // áudio sendo gravado
};

function profile(uid) {
  return S.profiles.get(uid) || { uid, name: '...', photo: '', lastActive: 0 };
}
function watchUser(uid) {
  if (!uid || S.profileSubs.has(uid)) return;
  S.profileSubs.set(
    uid,
    api.watchProfile(uid, (p) => {
      if (p) S.profiles.set(uid, p);
      if (uid === S.me.uid) S.myProfile = p;
      scheduleRender();
    })
  );
}

const isDm = (c) => c && c.type === 'dm';
const otherOf = (c) => (isDm(c) ? c.members.find((m) => m !== S.me.uid) || S.me.uid : null);
const convoName = (c) => (isDm(c) ? profile(otherOf(c)).name : c.name || 'Espaço');
const isOnline = (uid) => Date.now() - (profile(uid).lastActive || 0) < ONLINE_MS;
const unread = (c) => !!(c.lastMessage && c.lastMessage.by !== S.me.uid && (c.lastMessageAt || 0) > (c.reads[S.me.uid] || 0) + 1);
const currentConvo = () => S.convos.find((c) => c.id === S.current) || null;
const iBlocked = (uid) => !!(S.myProfile && (S.myProfile.blocked || []).includes(uid));
const isAdmin = (c) => !!(c && c.type === 'space' && (c.admins || []).includes(S.me.uid));

function avatarHtml(uid, size = 36, showDot = false) {
  const p = profile(uid);
  const initial = esc((p.name || '?').trim().charAt(0).toUpperCase());
  const hue = [...(uid || 'x')].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 360, 7);
  const img = p.photo ? `<img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="avatar" style="--s:${size}px;--h:${hue}"><span class="ini">${initial}</span>${img}${showDot ? `<i class="dot ${isOnline(uid) ? 'on' : ''}"></i>` : ''}</span>`;
}
function convoIcon(c, size = 36) {
  if (isDm(c)) return avatarHtml(otherOf(c), size, true);
  return `<span class="space-icon" style="--s:${size}px">${esc(c.emoji || '💬')}</span>`;
}

// ================================================================= telas
const app = $('#app');
const calls = initCalls({
  api, S, profile, avatarHtml, toast, esc, errText, convoName, isDm, otherOf, iBlocked,
  rerender: () => {
    lastMessagesHtml = '';
    scheduleRender();
  },
});
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    // na tela de convite, nada de redesenhar a lista por cima
    if (S.me && !/^#\/convite\//.test(location.hash)) renderShell();
  });
}

function renderSetup() {
  app.innerHTML = `<div class="login"><div class="login-card">
    <div class="logo-big">⚡</div><h1>Papo Flash</h1>
    <p>Falta só ligar o site ao seu Firebase: abra o arquivo <code>config.js</code> no GitHub e cole a configuração do seu app da Web.</p></div></div>`;
}

// ================================================================= login
let pendingUser = null;
const GOOGLE_ICON = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
const MS_ICON = `<svg viewBox="0 0 21 21" width="18" height="18" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>`;
const LS = { mode: 'home', tab: 'in', confirmation: null, phone: '', name: '', email: '' };

function loginShell(inner, msg) {
  app.innerHTML = `<div class="login"><div class="login-card">
    <div class="logo-big">⚡</div>
    <h1>Papo Flash</h1>
    ${inner}
    ${msg ? `<p class="login-error" role="alert">${esc(msg)}</p>` : ''}
  </div></div>`;
  setTimeout(() => $('.login-card input:not([type=hidden])')?.focus(), 30);
}

function renderLogin(msg) {
  if (LS.mode === 'email') return renderEmailLogin(msg);
  if (LS.mode === 'phone') return renderPhoneLogin(msg);
  loginShell(
    `<p class="lead">Converse com seus amigos e grupos, em tempo real.</p>
    <div class="login-options">
      <button class="btn login-opt" data-login="google">${GOOGLE_ICON}<span>Entrar com Google</span></button>
      <button class="btn login-opt" data-login-mode="email"><span class="opt-emoji" aria-hidden="true">✉️</span><span>Entrar com e-mail e senha</span></button>
    </div>
    <ul class="login-points">
      <li>💬 Conversas e espaços (grupos) ao vivo</li>
      <li>🔒 Só fala com você quem sabe o seu e-mail ou recebeu convite</li>
      <li>🆓 Grátis</li>
    </ul>`,
    msg
  );
}

function renderEmailLogin(msg) {
  const up = LS.tab === 'up';
  loginShell(
    `<div class="tabs" role="tablist">
      <button role="tab" class="${!up ? 'on' : ''}" aria-selected="${!up}" data-email-tab="in">Entrar</button>
      <button role="tab" class="${up ? 'on' : ''}" aria-selected="${up}" data-email-tab="up">Criar conta</button>
    </div>
    <form class="login-form" data-form="email">
      ${up ? `<label class="field"><span>Seu nome</span><input name="name" required maxlength="80" autocomplete="name" value="${esc(LS.name)}" /></label>` : ''}
      <label class="field"><span>E-mail</span><input name="email" type="email" required autocomplete="email" value="${esc(LS.email)}" /></label>
      <label class="field"><span>Senha${up ? ' (pelo menos 6 letras ou números)' : ''}</span>
        <span class="pass-row"><input name="password" type="password" required minlength="6" autocomplete="${up ? 'new-password' : 'current-password'}" />
        <button type="button" class="icon-btn" data-eye aria-label="Mostrar senha" title="Mostrar senha">👁️</button></span></label>
      <button class="btn primary wide" type="submit">${up ? 'Criar conta' : 'Entrar'}</button>
      ${!up ? '<button type="button" class="link-btn" data-forgot>Esqueci a senha</button>' : ''}
    </form>
    <button class="link-btn" data-login-mode="home">← Outros jeitos de entrar</button>`,
    msg
  );
}

function renderPhoneLogin(msg) {
  const step2 = !!LS.confirmation;
  loginShell(
    `${step2
      ? `<p>Mandamos um código por SMS para <b>${esc(LS.phone)}</b>.</p>
        <form class="login-form" data-form="code">
          <label class="field"><span>Código do SMS</span><input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="8" /></label>
          <button class="btn primary wide" type="submit">Entrar</button>
        </form>
        <button class="link-btn" data-phone-again>Não chegou? Mandar de novo</button>`
      : `<form class="login-form" data-form="phone">
          <label class="field"><span>Seu nome (se for a primeira vez)</span><input name="name" maxlength="80" autocomplete="name" value="${esc(LS.name)}" /></label>
          <label class="field"><span>Número do celular com DDD</span><input name="phone" type="tel" required autocomplete="tel" placeholder="(62) 99999-9999" value="${esc(LS.phone)}" /></label>
          <button class="btn primary wide" type="submit" id="phone-send">Mandar código por SMS</button>
          <p class="hint">Pode cobrar o SMS da sua operadora, como uma mensagem normal.</p>
        </form>`
    }
    <div id="recaptcha-box"></div>
    <button class="link-btn" data-login-mode="home">← Outros jeitos de entrar</button>`,
    msg
  );
}

function renderVerify(user, msg) {
  app.innerHTML = `<div class="login"><div class="login-card">
    <div class="logo-big">📬</div>
    <h1>Confirme seu e-mail</h1>
    <p>Mandamos um link para <b>${esc(user.rawEmail)}</b>. Abra seu e-mail, clique no link e depois volte aqui.</p>
    <p class="hint">Não achou? Olhe na pasta de spam ou lixo eletrônico.</p>
    <button class="btn primary wide" data-verified>Já confirmei</button>
    <button class="btn wide" data-resend>Mandar o link de novo</button>
    <button class="link-btn" data-logout>Sair e entrar com outra conta</button>
    ${msg ? `<p class="login-error" role="alert">${esc(msg)}</p>` : ''}
  </div></div>`;
}

async function busy(btn, fn) {
  const b = btn || $('.login-card .btn.primary');
  if (b) b.disabled = true;
  try {
    return await fn();
  } finally {
    if (b && b.isConnected) b.disabled = false;
  }
}

app.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const v = (n) => (f.elements[n] ? f.elements[n].value : '');
  const btn = f.querySelector('[type=submit]');
  try {
    if (f.dataset.form === 'email') {
      LS.email = v('email').trim();
      LS.name = v('name');
      if (LS.tab === 'up') {
        if (v('name').trim().length < 2) throw new Error('Digite seu nome.');
        await busy(btn, () => api.signUpEmail(v('name'), v('email'), v('password')));
      } else await busy(btn, () => api.signInEmail(v('email'), v('password')));
    } else if (f.dataset.form === 'phone') {
      LS.name = v('name');
      const phone = api.normalizePhone(v('phone'));
      if (phone.length < 12) throw new Error('Digite o número com DDD, por exemplo: (62) 99999-9999.');
      LS.phone = phone;
      LS.confirmation = await busy(btn, () => api.sendPhoneCode(phone, $('#recaptcha-box')));
      renderLogin();
    } else if (f.dataset.form === 'code') {
      await busy(btn, () => api.confirmPhoneCode(LS.confirmation, v('code'), LS.name));
    }
  } catch (err) {
    renderLogin(errText(err));
  }
});

function sidebarHtml() {
  const q = S.search.trim().toLowerCase();
  const list = S.convos
    .filter((c) => !q || convoName(c).toLowerCase().includes(q))
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  const item = (c) => {
    const last = c.lastMessage;
    const who = last && c.type === 'space' ? (last.by === S.me.uid ? 'Você: ' : `${profile(last.by).name.split(' ')[0]}: `) : last && last.by === S.me.uid ? 'Você: ' : '';
    const typing = Object.entries(c.typing || {}).some(([u, t]) => u !== S.me.uid && Date.now() - t < TYPING_MS);
    return `<a href="#/c/${c.id}" class="conv ${c.id === S.current ? 'active' : ''} ${unread(c) ? 'unread' : ''}" data-cid="${c.id}">
      ${convoIcon(c, 34)}
      <span class="conv-main"><span class="conv-name">${esc(convoName(c))}</span>
        <span class="conv-last">${typing ? '<em>digitando…</em>' : last ? esc(who + (last.text || '')) : isDm(c) ? 'Diga oi! 👋' : 'Espaço novo'}</span></span>
      <span class="conv-side"><span class="conv-time">${shortWhen(c.lastMessageAt)}</span>${unread(c) ? '<i class="badge"></i>' : ''}</span></a>`;
  };
  const dms = list.filter(isDm);
  const spaces = list.filter((c) => !isDm(c));
  const notif = 'Notification' in window && Notification.permission === 'default';
  return `<div class="side-top">
      <button class="btn primary new-btn" data-new>✏️ Novo chat</button>
      <label class="search"><span class="sr">Procurar conversa</span><input data-search placeholder="Procurar" value="${esc(S.search)}" /></label>
    </div>
    ${notif ? `<button class="notif-btn" data-notif>🔔 Ativar avisos de mensagem nova</button>` : ''}
    ${canOfferInstall() ? `<button class="notif-btn" data-install>📲 Instalar o app no celular</button>` : ''}
    <nav class="side-lists">
      <h3>Conversas</h3>
      ${dms.length ? dms.map(item).join('') : `<p class="side-empty">${S.convosLoaded ? 'Nenhuma conversa ainda.' : 'Carregando…'}</p>`}
      <h3>Espaços</h3>
      ${spaces.length ? spaces.map(item).join('') : `<p class="side-empty">${S.convosLoaded ? 'Crie um espaço para conversar em grupo.' : ''}</p>`}
    </nav>`;
}

function topbarHtml() {
  return `<header class="topbar">
    <button class="icon-btn only-mobile" data-back aria-label="Voltar para a lista" ${S.current ? '' : 'hidden'}>←</button>
    <a href="#/" class="brand"><span class="logo">⚡</span><span>Papo Flash</span></a>
    <span class="grow"></span>
    <button class="icon-btn" data-theme-toggle aria-label="Trocar tema claro/escuro" title="Tema claro/escuro">🌓</button>
    <button class="me-btn" data-menu aria-label="Minha conta">${avatarHtml(S.me.uid, 34)}</button>
  </header>`;
}

function emptyChatHtml() {
  return `<div class="empty-chat"><div class="empty-art">💬</div><h2>Olá, ${esc(S.me.name.split(' ')[0])}!</h2>
    <p>Escolha uma conversa ao lado ou comece uma nova.</p>
    <div class="empty-actions"><button class="btn primary" data-new-dm>👤 Conversar com alguém</button><button class="btn" data-new-space>👥 Criar espaço</button></div></div>`;
}

function headerHtml(c) {
  if (isDm(c)) {
    const o = otherOf(c);
    return `<div class="chat-head">${avatarHtml(o, 40, true)}<div class="chat-title"><h2>${esc(profile(o).name)}</h2><small>${esc(lastSeen(profile(o).lastActive))}</small></div>
      <span class="grow"></span>${calls.headerButtons(c)}<button class="icon-btn" data-dm-menu aria-label="Opções da conversa">⋮</button></div>${calls.bar(c)}`;
  }
  return `<div class="chat-head">${convoIcon(c, 40)}<div class="chat-title"><h2>${esc(c.name)}</h2><small>${c.members.length} membro${c.members.length === 1 ? '' : 's'}${c.description ? ' · ' + esc(c.description) : ''}</small></div>
    <span class="grow"></span>
    ${calls.headerButtons(c)}
    ${isAdmin(c) ? '<button class="btn small hide-small" data-invite>➕ Convidar</button>' : ''}
    <button class="icon-btn ${S.showMembers ? 'on' : ''}" data-members aria-label="Membros" title="Membros">👥</button></div>${calls.bar(c)}`;
}

function messageHtml(m, prev) {
  if (m.sys === 'call') return calls.sysHtml(m);
  const mine = m.by === S.me.uid;
  const grouped = prev && !prev.sys && prev.by === m.by && !prev.deleted && m.at - prev.at < 5 * 60 * 1000 && new Date(prev.at).toDateString() === new Date(m.at).toDateString();
  const reactions = Object.entries(m.reactions || {}).filter(([, us]) => us && us.length);
  const big = !m.deleted && onlyEmoji(m.text || '');
  const editing = S.editing === m.id;
  return `<div class="msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${m.deleted ? 'deleted' : ''} ${S.tapped === m.id ? 'tapped' : ''}" data-mid="${m.id}">
    <div class="msg-av">${grouped ? `<span class="msg-hover-time">${timeOf(m.at)}</span>` : avatarHtml(m.by, 36)}</div>
    <div class="msg-body">
      ${grouped ? '' : `<div class="msg-meta"><strong>${mine ? 'Você' : esc(profile(m.by).name)}</strong><time>${timeOf(m.at)}</time></div>`}
      ${m.replyTo ? `<div class="msg-reply" data-jump="${esc(m.replyTo.id)}"><b>${esc(m.replyTo.by === S.me.uid ? 'Você' : profile(m.replyTo.by).name)}</b> ${esc(m.replyTo.text)}</div>` : ''}
      ${
        m.deleted
          ? '<div class="msg-text"><em>🗑️ Mensagem apagada</em></div>'
          : editing
            ? `<form class="edit-form" data-edit-form><textarea rows="2" maxlength="${MAX_LEN}">${esc(m.text)}</textarea><div><button class="btn small ghost" type="button" data-edit-cancel>Cancelar</button><button class="btn small primary" type="submit">Salvar</button></div></form>`
            : `${m.file ? fileHtml(m) : ''}${m.text || m.editedAt ? `<div class="msg-text ${big ? 'big' : ''}">${formatText(m.text || '')}${m.editedAt ? ' <span class="edited">(editada)</span>' : ''}</div>` : ''}`
      }
      ${
        reactions.length
          ? `<div class="reacts">${reactions
              .map(([e, us]) => `<button class="react ${us.includes(S.me.uid) ? 'me' : ''}" data-react="${esc(e)}" title="${esc(us.map((u) => (u === S.me.uid ? 'Você' : profile(u).name)).join(', '))}">${esc(e)} <b>${us.length}</b></button>`)
              .join('')}</div>`
          : ''
      }
    </div>
    ${
      m.deleted || editing
        ? ''
        : `<div class="msg-tools">${QUICK.slice(0, 3).map((e) => `<button data-react="${e}" title="Reagir">${e}</button>`).join('')}
        <button data-react-more title="Mais reações">😀</button><button data-reply title="Responder">↩️</button>
        ${mine ? '<button data-edit title="Editar">✏️</button><button data-del title="Apagar">🗑️</button>' : '<button data-report title="Denunciar">⚑</button>'}</div>`
    }
  </div>`;
}

function messagesHtml() {
  const all = [...S.older, ...S.messages];
  if (!all.length) {
    const c = currentConvo();
    return `<div class="first-msg">${c ? convoIcon(c, 64) : ''}<p>${c && isDm(c) ? `Este é o começo da sua conversa com <b>${esc(convoName(c))}</b>.` : 'Este é o começo do espaço. Mande a primeira mensagem! 🎉'}</p></div>`;
  }
  let out = S.hasMore ? '<div class="older"><button class="btn small ghost" data-older>Carregar mensagens antigas</button></div>' : '';
  let prev = null;
  for (const m of all) {
    if (!prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString()) out += `<div class="day"><span>${esc(dayLabel(m.at))}</span></div>`;
    out += messageHtml(m, prev);
    prev = m;
  }
  return out + uploadsHtml();
}

function uploadsHtml() {
  return S.uploads
    .filter((u) => u.cid === S.current)
    .map(
      (u) => `<div class="msg mine uploading"><div class="msg-av">${avatarHtml(S.me.uid, 36)}</div><div class="msg-body">
      <div class="upload-card">${KIND_ICON[u.kind] || '📎'} Enviando ${esc(KIND_NAME[u.kind] || 'arquivo')}… <b>${Math.round(u.progress * 100)}%</b>
      <div class="upload-bar"><i style="width:${Math.round(u.progress * 100)}%"></i></div></div></div></div>`
    )
    .join('');
}

// ================================================================= arquivos (foto, vídeo, áudio, documento)
const KIND_ICON = { image: '📷', video: '🎬', audio: '🎤', file: '📎' };
const KIND_NAME = { image: 'foto', video: 'vídeo', audio: 'áudio', file: 'arquivo' };
const FILE_CACHE = new Map(); // id do arquivo → endereço local (blob:)
const FILE_LOADING = new Map();
const MAX_AUDIO_SEC = 5 * 60;

function sizeLabel(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
function durLabel(sec) {
  sec = Math.round(sec || 0);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function fileIcon(f) {
  const n = (f.name || '').toLowerCase();
  if (/\.pdf$/.test(n)) return '📕';
  if (/\.(docx?|odt|rtf|txt)$/.test(n)) return '📄';
  if (/\.(xlsx?|ods|csv)$/.test(n)) return '📊';
  if (/\.(pptx?|odp)$/.test(n)) return '📽️';
  if (/\.(zip|rar|7z)$/.test(n)) return '🗜️';
  return '📎';
}

function fileHtml(m) {
  const f = m.file;
  const url = FILE_CACHE.get(f.id);
  if (f.kind === 'image') {
    const ratio = f.w && f.h ? `aspect-ratio:${f.w}/${f.h};` : '';
    return `<button class="media media-img" data-open-img style="${ratio}" aria-label="Abrir foto">${url ? `<img src="${url}" alt="Foto" />` : `<span class="media-wait" data-autoload="${esc(m.id)}">📷</span>`}</button>`;
  }
  if (f.kind === 'video') {
    return url
      ? `<video class="media media-video" controls playsinline preload="metadata" src="${url}"></video>`
      : `<button class="media-load" data-load-file>▶️ <span>Vídeo${f.dur ? ` · ${durLabel(f.dur)}` : ''}<small>${sizeLabel(f.size)} · toque para ver</small></span></button>`;
  }
  if (f.kind === 'audio') {
    return url
      ? `<audio class="media-audio" controls preload="auto" src="${url}"></audio>`
      : `<button class="media-load audio" data-load-file>▶️ <span>Áudio${f.dur ? ` · ${durLabel(f.dur)}` : ''}<small>toque para ouvir</small></span></button>`;
  }
  return `<div class="file-card"><span class="file-ico">${fileIcon(f)}</span><span class="file-info"><b>${esc(f.name || 'arquivo')}</b><small>${sizeLabel(f.size)}</small></span>
    <button class="btn small" data-download>Baixar</button></div>`;
}

function getFileUrl(cid, f) {
  if (FILE_CACHE.has(f.id)) return Promise.resolve(FILE_CACHE.get(f.id));
  if (!FILE_LOADING.has(f.id)) {
    FILE_LOADING.set(
      f.id,
      api
        .loadFile(cid, f)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          FILE_CACHE.set(f.id, url);
          return url;
        })
        .finally(() => FILE_LOADING.delete(f.id))
    );
  }
  return FILE_LOADING.get(f.id);
}

/** Fotos carregam sozinhas quando aparecem na tela. */
function loadVisibleImages() {
  const cid = S.current;
  document.querySelectorAll('[data-autoload]').forEach((el) => {
    const m = findMessage(el.dataset.autoload);
    if (!m || !m.file || FILE_LOADING.has(m.file.id)) return;
    getFileUrl(cid, m.file)
      .then((url) => {
        if (S.current !== cid) return;
        const box = $('[data-messages]');
        const atBottom = box && box.scrollHeight - box.scrollTop - box.clientHeight < 120;
        const holder = $(`[data-mid="${CSS.escape(m.id)}"] [data-autoload]`);
        if (holder) holder.outerHTML = `<img src="${url}" alt="Foto" />`;
        lastMessagesHtml = '';
        if (atBottom) scrollToBottom();
      })
      .catch(() => {
        const holder = $(`[data-mid="${CSS.escape(m.id)}"] [data-autoload]`);
        if (holder) holder.textContent = '⚠️';
      });
  });
}

function downloadUrl(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'arquivo';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openImage(m) {
  const url = FILE_CACHE.get(m.file.id);
  if (!url) return;
  dialog({
    title: m.by === S.me.uid ? 'Sua foto' : `Foto de ${profile(m.by).name}`,
    body: `<img class="lightbox-img" src="${url}" alt="Foto" />${m.text ? `<p>${formatText(m.text)}</p>` : ''}`,
    actions: [
      { label: 'Baixar', kind: 'ghost', onClick: () => downloadUrl(url, `foto-papo-flash-${m.id.slice(0, 6)}.jpg`) },
      { label: 'Fechar', kind: 'primary' },
    ],
  }).el.classList.add('wide-modal');
}

/** Foto: diminui para no máximo 1600 px (fica leve e rápida). */
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  return { blob, w, h };
}

function mediaDuration(blob, tag) {
  return new Promise((resolve) => {
    const el = document.createElement(tag);
    const url = URL.createObjectURL(blob);
    const done = (v) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done({ dur: isFinite(el.duration) ? Math.round(el.duration) : 0, w: el.videoWidth || 0, h: el.videoHeight || 0 });
    el.onerror = () => done({ dur: 0, w: 0, h: 0 });
    setTimeout(() => done({ dur: 0, w: 0, h: 0 }), 4000);
    el.src = url;
  });
}

/** Escolheu um arquivo (botão 📎, colar ou arrastar): prepara e mostra a prévia. */
async function pickFile(file) {
  const c = currentConvo();
  if (!c || !file) return;
  if (isDm(c) && iBlocked(otherOf(c))) return;
  let kind = 'file';
  let blob = file;
  let meta = { name: String(file.name || 'arquivo').slice(0, 200), type: file.type || 'application/octet-stream' };
  try {
    if (/^image\//.test(file.type) && !/gif|svg/.test(file.type)) {
      const r = await shrinkImage(file);
      kind = 'image';
      blob = r.blob;
      meta = { ...meta, type: 'image/jpeg', w: r.w, h: r.h };
    } else if (/^image\/gif/.test(file.type)) {
      kind = 'image';
    } else if (/^video\//.test(file.type)) {
      kind = 'video';
      const d = await mediaDuration(file, 'video');
      meta = { ...meta, dur: d.dur, w: d.w, h: d.h };
    } else if (/^audio\//.test(file.type)) {
      kind = 'audio';
      meta = { ...meta, dur: (await mediaDuration(file, 'audio')).dur };
    }
  } catch (_) {
    kind = 'file'; // não deu para abrir como foto (ex.: HEIC no PC): vai como arquivo
    blob = file;
  }
  if (blob.size > api.FILE_LIMIT) {
    return toast(
      kind === 'video' ? `Esse vídeo tem ${sizeLabel(blob.size)}. O máximo é 10 MB (mais ou menos 20 a 30 segundos de vídeo). Grave um vídeo mais curto.` : `Esse arquivo tem ${sizeLabel(blob.size)}. O máximo é 10 MB.`,
      'error'
    );
  }
  const preview = URL.createObjectURL(blob);
  const show =
    kind === 'image'
      ? `<img class="send-preview" src="${preview}" alt="Prévia da foto" />`
      : kind === 'video'
        ? `<video class="send-preview" src="${preview}" controls playsinline muted></video>`
        : kind === 'audio'
          ? `<audio src="${preview}" controls></audio>`
          : `<div class="file-card"><span class="file-ico">${fileIcon(meta)}</span><span class="file-info"><b>${esc(meta.name)}</b><small>${sizeLabel(blob.size)}</small></span></div>`;
  const reply = S.replyTo;
  const draft = $('.composer textarea')?.value || '';
  dialog({
    title: `Enviar ${KIND_NAME[kind]}`,
    body: `${show}<form><label class="field"><span>Legenda (opcional)</span><input name="caption" maxlength="1000" value="${esc(draft.trim())}" /></label></form>`,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => URL.revokeObjectURL(preview) },
      {
        label: 'Enviar',
        kind: 'primary',
        onClick: (w) => {
          const caption = $('[name=caption]', w).value.trim();
          const ta = $('.composer textarea');
          if (ta && draft && caption === draft.trim()) {
            ta.value = '';
            autosize(ta);
          }
          URL.revokeObjectURL(preview);
          S.replyTo = null;
          uploadAndSend(c, kind, blob, meta, caption, reply);
        },
      },
    ],
  });
}

async function uploadAndSend(c, kind, blob, meta, caption, reply) {
  const up = { id: Math.random().toString(36).slice(2), cid: c.id, kind, progress: 0 };
  S.uploads.push(up);
  lastMessagesHtml = '';
  scheduleRender();
  setTimeout(() => scrollToBottom(), 50);
  try {
    const saved = await api.uploadFile(c.id, S.me.uid, blob, (p) => {
      up.progress = p;
      renderMessages();
    });
    const file = { id: saved.id, chunks: saved.chunks, size: saved.size, kind, name: meta.name, type: meta.type };
    for (const k of ['w', 'h', 'dur']) if (meta[k]) file[k] = Math.round(meta[k]);
    FILE_CACHE.set(saved.id, URL.createObjectURL(blob));
    S.uploads = S.uploads.filter((u) => u !== up);
    await api.sendMessage(c.id, S.me.uid, caption, reply, file);
  } catch (err) {
    S.uploads = S.uploads.filter((u) => u !== up);
    toast(err && err.code === 'permission-denied' ? 'Não foi possível enviar.' : errText(err), 'error');
  }
  lastMessagesHtml = '';
  scheduleRender();
}

// um só campo de arquivo para o site todo (não some quando a tela redesenha)
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.hidden = true;
document.body.appendChild(fileInput);
fileInput.addEventListener('change', () => fileInput.files[0] && pickFile(fileInput.files[0]));
// colar uma imagem (Ctrl+V) na caixa de mensagem
app.addEventListener('paste', (e) => {
  if (!e.target.closest || !e.target.closest('.composer')) return;
  const f = [...(e.clipboardData?.files || [])][0];
  if (f) {
    e.preventDefault();
    pickFile(f);
  }
});
// arrastar um arquivo para dentro da conversa
app.addEventListener('dragover', (e) => {
  if (e.target.closest && e.target.closest('.chat') && [...(e.dataTransfer?.types || [])].includes('Files')) {
    e.preventDefault();
    e.target.closest('.chat').classList.add('drop');
  }
});
app.addEventListener('dragleave', (e) => {
  if (e.target.closest && e.target.closest('.chat') && !e.relatedTarget?.closest?.('.chat')) e.target.closest('.chat').classList.remove('drop');
});
app.addEventListener('drop', (e) => {
  const chat = e.target.closest && e.target.closest('.chat');
  if (!chat) return;
  e.preventDefault();
  chat.classList.remove('drop');
  const f = [...(e.dataTransfer?.files || [])][0];
  if (f) pickFile(f);
});

// ---------- gravar áudio
const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
function pickAudioType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}
async function startRecording() {
  const c = currentConvo();
  if (!c || S.recording) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) {
    return toast('Não deu para usar o microfone. Libere o microfone para este site nas configurações do navegador.', 'error');
  }
  const type = pickAudioType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
  const parts = [];
  rec.ondataavailable = (e) => e.data && e.data.size && parts.push(e.data);
  S.recording = { cid: c.id, rec, stream, parts, start: Date.now(), send: false };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const r = S.recording;
    S.recording = null;
    clearInterval(recTimer);
    scheduleRender();
    if (!r || !r.send || !parts.length) return;
    const mime = (rec.mimeType || type || 'audio/webm').split(';')[0];
    const blob = new Blob(parts, { type: mime });
    const dur = Math.max(1, Math.round((Date.now() - r.start) / 1000));
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
    const conv = S.convos.find((x) => x.id === r.cid);
    if (conv) uploadAndSend(conv, 'audio', blob, { name: `audio-${new Date().toISOString().slice(0, 10)}.${ext}`, type: mime, dur }, '', null);
  };
  rec.start(1000);
  scheduleRender();
  recTimer = setInterval(() => {
    if (!S.recording) return;
    const sec = (Date.now() - S.recording.start) / 1000;
    const el = $('[data-rec-time]');
    if (el) el.textContent = durLabel(sec);
    if (sec >= MAX_AUDIO_SEC) stopRecording(true);
  }, 500);
}
let recTimer = null;
function stopRecording(send) {
  if (!S.recording) return;
  S.recording.send = send;
  try {
    S.recording.rec.stop();
  } catch (_) {
    S.recording.stream.getTracks().forEach((t) => t.stop());
    S.recording = null;
    scheduleRender();
  }
}

function typingLine(c) {
  const names = Object.entries(c.typing || {})
    .filter(([u, t]) => u !== S.me.uid && Date.now() - t < TYPING_MS)
    .map(([u]) => profile(u).name.split(' ')[0]);
  if (!names.length) return '';
  return `<span class="typing-dots"><i></i><i></i><i></i></span> ${esc(names.slice(0, 3).join(', '))} ${names.length === 1 ? 'está' : 'estão'} digitando…`;
}

function composerHtml(c) {
  if (isDm(c) && iBlocked(otherOf(c))) {
    return `<div class="blocked-bar">Você bloqueou esta pessoa. <button class="btn small" data-unblock>Desbloquear</button></div>`;
  }
  return `<div class="composer-wrap">
    <div class="typing" aria-live="polite">${typingLine(c)}</div>
    ${S.replyTo ? `<div class="replying">↩️ Respondendo <b>${esc(S.replyTo.by === S.me.uid ? 'você' : profile(S.replyTo.by).name)}</b>: ${esc(String(S.replyTo.text).slice(0, 90))}<button class="icon-btn" data-reply-cancel aria-label="Cancelar resposta">✕</button></div>` : ''}
    ${
      S.recording && S.recording.cid === c.id
        ? `<div class="composer recording"><span class="rec-dot" aria-hidden="true"></span><span>Gravando áudio <b data-rec-time>${durLabel((Date.now() - S.recording.start) / 1000)}</b></span>
          <span class="grow"></span><button type="button" class="icon-btn" data-rec-cancel aria-label="Cancelar áudio" title="Cancelar">🗑️</button>
          <button type="button" class="send" data-rec-send aria-label="Enviar áudio" title="Enviar áudio">➤</button></div>`
        : `<form class="composer" data-send>
      <button type="button" class="icon-btn" data-emoji aria-label="Emojis">😀</button>
      <button type="button" class="icon-btn" data-attach aria-label="Mandar foto, vídeo ou arquivo" title="Foto, vídeo ou arquivo">📎</button>
      <textarea rows="1" maxlength="${MAX_LEN}" placeholder="Mensagem para ${esc(convoName(c))}" aria-label="Escreva uma mensagem"></textarea>
      ${canRecord() ? '<button type="button" class="icon-btn" data-record aria-label="Gravar áudio" title="Gravar áudio">🎤</button>' : ''}
      <button class="send" type="submit" aria-label="Enviar">➤</button>
    </form>`
    }

    <p class="hint">Enter envia · Shift+Enter pula linha · *negrito* _itálico_ ~riscado~</p></div>`;
}

function membersHtml(c) {
  if (!c || isDm(c) || !S.showMembers) return '';
  const admin = isAdmin(c);
  const list = c.members.slice().sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || profile(a).name.localeCompare(profile(b).name));
  return `<aside class="members"><header><h3>Membros (${c.members.length})</h3><button class="icon-btn" data-members aria-label="Fechar membros">✕</button></header>
    <ul>${list
      .map(
        (u) => `<li>${avatarHtml(u, 32, true)}<span class="mem-name">${esc(u === S.me.uid ? `${profile(u).name} (você)` : profile(u).name)}${(c.admins || []).includes(u) ? '<small class="tag">admin</small>' : ''}</span>
        ${u !== S.me.uid ? `<button class="icon-btn" data-mem-menu="${u}" aria-label="Opções">⋮</button>` : ''}</li>`
      )
      .join('')}</ul>
    <div class="members-actions">
      ${admin ? '<button class="btn small" data-edit-space>✏️ Editar espaço</button><button class="btn small" data-invite>➕ Convidar</button>' : ''}
      <button class="btn small ghost danger-text" data-leave>Sair do espaço</button>
      ${admin ? '<button class="btn small ghost danger-text" data-del-space>Excluir espaço</button>' : ''}
    </div></aside>`;
}

let lastShellKey = '';
function renderShell() {
  const c = currentConvo();
  if (S.current && !c && S.convosLoaded) {
    // conversa não existe mais ou saí dela
    location.hash = '#/';
    return;
  }
  const key = `${S.current}|${!!c}|${S.showMembers}`;
  if (key !== lastShellKey || !$('.shell')) {
    lastShellKey = key;
    app.innerHTML = `<div class="shell ${S.current ? 'has-chat' : ''} ${S.showMembers && c && !isDm(c) ? 'with-members' : ''}">
      ${topbarHtml()}
      <aside class="sidebar">${sidebarHtml()}</aside>
      <main class="chat">${c ? `<div data-head>${headerHtml(c)}</div><div class="messages" data-messages>${messagesHtml()}</div><div data-composer>${composerHtml(c)}</div>` : emptyChatHtml()}</main>
      <div data-members-panel>${membersHtml(c)}</div>
    </div>`;
    if (c) {
      scrollToBottom(true);
      $('.composer textarea')?.focus();
    }
    updateTitle();
    return;
  }
  // atualizações parciais (não perde o que está sendo digitado)
  $('.sidebar').innerHTML = sidebarHtml();
  const searchInput = $('[data-search]');
  if (searchInput && document.activeElement !== searchInput) searchInput.value = S.search;
  $('.topbar').outerHTML = topbarHtml();
  if (c) {
    $('[data-head]').innerHTML = headerHtml(c);
    renderMessages();
    const comp = $('[data-composer]');
    const blockedNow = isDm(c) && iBlocked(otherOf(c));
    const hasComposer = !!$('.composer', comp);
    const recNow = !!(S.recording && S.recording.cid === c.id);
    if (blockedNow || !hasComposer) comp.innerHTML = composerHtml(c);
    else if (recNow !== !!$('.composer.recording', comp)) {
      // entrou ou saiu da gravação de áudio: guarda o texto que estava escrito
      const ta = $('.composer textarea', comp);
      if (ta) S.draftWhileRec = ta.value;
      comp.innerHTML = composerHtml(c);
      const nta = $('.composer textarea', comp);
      if (nta && S.draftWhileRec) {
        nta.value = S.draftWhileRec;
        autosize(nta);
        S.draftWhileRec = '';
      }
    } else {
      $('.typing', comp).innerHTML = typingLine(c);
      const rep = $('.replying', comp);
      const want = !!S.replyTo;
      if (want !== !!rep || (want && rep && !rep.textContent.includes(String(S.replyTo.text).slice(0, 20)))) {
        const ta = $('.composer textarea', comp);
        const val = ta ? ta.value : '';
        comp.innerHTML = composerHtml(c);
        const nta = $('.composer textarea', comp);
        nta.value = val;
        autosize(nta);
        nta.focus();
      }
    }
    $('[data-members-panel]').innerHTML = membersHtml(c);
  }
  updateTitle();
}

let lastMessagesHtml = '';
function renderMessages() {
  const box = $('[data-messages]');
  if (!box) return;
  const html = messagesHtml();
  if (html === lastMessagesHtml && box.innerHTML) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const prevHeight = box.scrollHeight;
  const prevTop = box.scrollTop;
  const editingText = S.editing ? $('[data-edit-form] textarea', box)?.value : null;
  lastMessagesHtml = html;
  box.innerHTML = html;
  if (S.editing && editingText != null) {
    const ta = $('[data-edit-form] textarea', box);
    if (ta) ta.value = editingText;
  }
  if (keepScrollOnOlder) {
    box.scrollTop = box.scrollHeight - prevHeight + prevTop;
    keepScrollOnOlder = false;
  } else if (nearBottom) scrollToBottom();
  loadVisibleImages();
}
let keepScrollOnOlder = false;

function scrollToBottom(force) {
  const box = $('[data-messages]');
  if (!box) return;
  if (force) lastMessagesHtml = box.innerHTML;
  box.scrollTop = box.scrollHeight;
  // imagens de perfil carregando podem mudar a altura
  setTimeout(() => (box.scrollTop = box.scrollHeight), 60);
}

function updateTitle() {
  const n = S.convos.filter(unread).length;
  document.title = n ? `(${n}) Papo Flash` : 'Papo Flash';
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
}

// ================================================================= abrir conversa
function openConversation(cid) {
  if (S.current === cid) return;
  if (S.msgUnsub) S.msgUnsub();
  if (S.current) stopTyping();
  S.current = cid;
  S.messages = [];
  S.older = [];
  S.hasMore = false;
  S.replyTo = null;
  S.editing = null;
  lastMessagesHtml = '';
  if (!cid) {
    S.msgUnsub = null;
    scheduleRender();
    return;
  }
  S.msgUnsub = api.watchMessages(
    cid,
    (msgs, more) => {
      if (S.current !== cid) return;
      // mensagens que saíram da "janela" das 50 últimas continuam na tela
      const firstAt = msgs.length ? msgs[0].at : Infinity;
      const ids = new Set(msgs.map((m) => m.id));
      const dropped = S.messages.filter((m) => !ids.has(m.id) && m.at < firstAt);
      if (dropped.length) S.older = [...S.older, ...dropped];
      S.messages = msgs;
      if (!S.older.length) S.hasMore = more;
      for (const m of msgs) watchUser(m.by);
      if ($('[data-messages]')) renderMessages();
      else scheduleRender();
      markReadSoon();
    },
    (err) => {
      if (S.current === cid) toast(errText(err), 'error');
    }
  );
  scheduleRender();
}

let readTimer = null;
function markReadSoon() {
  clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    const c = currentConvo();
    if (!c || document.hidden) return;
    if ((c.lastMessageAt || 0) > (c.reads[S.me.uid] || 0)) api.markRead(c.id, S.me.uid);
  }, 700);
}

function stopTyping() {
  clearTimeout(S.typingTimer);
  if (S.typingSentAt && S.current) api.setTyping(S.current, S.me.uid, false);
  S.typingSentAt = 0;
}
function onTypingInput() {
  if (!S.current) return;
  const now = Date.now();
  if (now - S.typingSentAt > 4000) {
    S.typingSentAt = now;
    api.setTyping(S.current, S.me.uid, true);
  }
  clearTimeout(S.typingTimer);
  S.typingTimer = setTimeout(stopTyping, 5000);
}

// ================================================================= ações
async function send(form) {
  const ta = $('textarea', form);
  const text = ta.value.replace(/\s+$/, '').replace(/^\n+/, '');
  if (!text.trim()) return;
  if (text.length > MAX_LEN) return toast(`A mensagem pode ter no máximo ${MAX_LEN} letras.`, 'error');
  const c = currentConvo();
  if (!c) return;
  const reply = S.replyTo;
  ta.value = '';
  autosize(ta);
  S.replyTo = null;
  clearTimeout(S.typingTimer);
  S.typingSentAt = 0;
  scheduleRender();
  try {
    await api.sendMessage(c.id, S.me.uid, text, reply);
  } catch (err) {
    ta.value = text;
    autosize(ta);
    toast(err && err.code === 'permission-denied' ? 'Não foi possível enviar. Talvez esta pessoa tenha bloqueado você.' : errText(err), 'error');
  }
}

function findMessage(mid) {
  return [...S.older, ...S.messages].find((m) => m.id === mid);
}

function emojiPicker(anchor, onPick) {
  document.querySelectorAll('.emoji-pop').forEach((e) => e.remove());
  const pop = document.createElement('div');
  pop.className = 'emoji-pop';
  pop.innerHTML = EMOJIS.map((e) => `<button type="button" data-pick="${e}">${e}</button>`).join('');
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  pop.style.top = `${r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8}px`;
  const close = (e) => {
    if (e && pop.contains(e.target)) {
      const b = e.target.closest('[data-pick]');
      if (b) {
        onPick(b.dataset.pick);
        pop.remove();
        document.removeEventListener('mousedown', close, true);
      }
      return;
    }
    pop.remove();
    document.removeEventListener('mousedown', close, true);
  };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  pop.addEventListener('click', (e) => close(e));
}

function newDmDialog() {
  dialog({
    title: 'Conversar com alguém',
    body: `<form><label class="field"><span>E-mail da pessoa</span><input name="contact" type="email" required placeholder="nome@gmail.com" autocomplete="off" /></label>
      <p class="modal-error" hidden></p><p class="hint">Use o mesmo e-mail que a pessoa usa para entrar. Ela precisa ter entrado no Papo Flash pelo menos uma vez.</p></form>`,
    actions: [
      { label: 'Cancelar', kind: 'ghost' },
      {
        label: 'Abrir conversa',
        kind: 'primary',
        onClick: async (w) => {
          const raw = $('[name=contact]', w).value.trim();
          const email = raw.toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Esse e-mail não parece certo.');
          if (email === S.me.email) throw new Error('Esse é o seu e-mail 🙂');
          const uid = await api.findUserByEmail(email);
          if (!uid) throw new Error('Não achamos ninguém com esse e-mail. Mande o link do site para a pessoa entrar primeiro.');
          if (uid === S.me.uid) throw new Error('Essa conta é você 🙂');
          const cid = await api.openDm(S.me.uid, uid);
          location.hash = `#/c/${cid}`;
        },
      },
    ],
  });
}

function spaceForm(c = {}) {
  const chosen = c.emoji || '💬';
  return `<form><label class="field"><span>Nome do espaço</span><input name="name" required maxlength="60" value="${esc(c.name || '')}" placeholder="Ex.: Turma do 7º B" /></label>
    <fieldset class="emoji-choose"><legend>Ícone</legend>${SPACE_EMOJIS.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${e === chosen ? 'checked' : ''}/><span>${e}</span></label>`).join('')}</fieldset>
    <label class="field"><span>Descrição (opcional)</span><input name="description" maxlength="200" value="${esc(c.description || '')}" placeholder="Sobre o que é este espaço?" /></label>
    <p class="modal-error" hidden></p></form>`;
}

function newSpaceDialog() {
  dialog({
    title: 'Criar espaço',
    body: spaceForm(),
    actions: [
      { label: 'Cancelar', kind: 'ghost' },
      {
        label: 'Criar',
        kind: 'primary',
        onClick: async (w) => {
          const name = $('[name=name]', w).value.trim();
          if (name.length < 2) throw new Error('Dê um nome ao espaço.');
          const cid = await api.createSpace(S.me.uid, { name, emoji: $('[name=emoji]:checked', w)?.value, description: $('[name=description]', w).value.trim() });
          location.hash = `#/c/${cid}`;
          setTimeout(() => inviteDialog(cid, { name, emoji: $('[name=emoji]:checked', w)?.value }), 400);
        },
      },
    ],
  });
}

function editSpaceDialog(c) {
  dialog({
    title: 'Editar espaço',
    body: spaceForm(c),
    actions: [
      { label: 'Cancelar', kind: 'ghost' },
      {
        label: 'Salvar',
        kind: 'primary',
        onClick: async (w) => {
          const name = $('[name=name]', w).value.trim();
          if (name.length < 2) throw new Error('Dê um nome ao espaço.');
          await api.updateSpace(c.id, { name, emoji: $('[name=emoji]:checked', w)?.value, description: $('[name=description]', w).value.trim() });
          toast('Espaço atualizado.', 'ok');
        },
      },
    ],
  });
}

async function inviteDialog(cid, info) {
  const c = S.convos.find((x) => x.id === cid) || info;
  let code;
  try {
    code = await api.createInvite(cid, S.me.uid, { name: c.name, emoji: c.emoji });
  } catch (err) {
    return toast(errText(err), 'error');
  }
  const link = `${location.origin}${location.pathname}#/convite/${code}`;
  dialog({
    title: 'Convidar para o espaço',
    body: `<p>Mande este link para quem você quer no espaço <b>${esc(c.name)}</b>. Quem abrir e entrar com o Google vira membro.</p>
      <div class="copy-row"><input readonly value="${esc(link)}" aria-label="Link do convite" /><button class="btn primary" data-copy>Copiar</button></div>
      <p class="hint">Qualquer pessoa com o link pode entrar, então mande só para quem você conhece.</p>`,
    actions: [{ label: 'Pronto', kind: 'primary' }],
    onOpen: (w) => {
      $('[data-copy]', w).addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(link);
        } catch (_) {
          $('input', w).select();
          document.execCommand('copy');
        }
        toast('Link copiado!', 'ok');
      });
    },
  });
}

async function showInvite(code) {
  app.innerHTML = `<div class="login"><div class="login-card"><div class="spinner"></div></div></div>`;
  let inv = null;
  try {
    inv = await api.getInvite(code);
  } catch (_) {
    inv = null;
  }
  if (!inv) {
    app.innerHTML = `<div class="login"><div class="login-card"><div class="logo-big">🤷</div><h1>Convite não encontrado</h1><p>O link pode estar errado ou o convite foi apagado.</p><a class="btn primary" href="#/">Ir para o Papo Flash</a></div></div>`;
    return;
  }
  if (S.convos.some((c) => c.id === inv.cid)) {
    location.hash = `#/c/${inv.cid}`;
    return;
  }
  app.innerHTML = `<div class="login"><div class="login-card"><div class="space-icon" style="--s:72px">${esc(inv.emoji || '💬')}</div>
    <h1>${esc(inv.name)}</h1><p>Você foi convidado(a) para este espaço.</p>
    <button class="btn primary" data-join="${esc(code)}">Entrar no espaço</button> <a class="btn ghost" href="#/">Agora não</a></div></div>`;
}

function menuAt(anchor, items) {
  document.querySelectorAll('.pop-menu').forEach((e) => e.remove());
  const m = document.createElement('div');
  m.className = 'pop-menu';
  m.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger-text' : ''}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = `${Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 6)}px`;
  m.style.left = `${Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth))}px`;
  const close = (e) => {
    if (e && m.contains(e.target)) return;
    m.remove();
    document.removeEventListener('mousedown', close, true);
  };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    close();
    items[Number(b.dataset.i)].onClick();
  });
}

function reportDialog(m) {
  dialog({
    title: 'Denunciar mensagem',
    body: `<form><p class="quote">${esc(m.text).slice(0, 300)}</p>
      <label class="field"><span>O que aconteceu?</span><select name="reason"><option>Ofensa ou bullying</option><option>Conteúdo impróprio</option><option>Spam</option><option>Outro motivo</option></select></label>
      <p class="hint">A denúncia vai para quem cuida do site. Se você se sentir em perigo, fale com um adulto de confiança.</p></form>`,
    actions: [
      { label: 'Cancelar', kind: 'ghost' },
      {
        label: 'Denunciar',
        kind: 'danger',
        onClick: async (w) => {
          await api.report({ by: S.me.uid, cid: S.current, mid: m.id, author: m.by, text: String(m.text).slice(0, 1000), reason: $('[name=reason]', w).value });
          toast('Denúncia enviada. Obrigado!', 'ok');
        },
      },
    ],
  });
}

// ================================================================= eventos
app.addEventListener('click', async (e) => {
  const t = e.target;
  const on = (sel) => t.closest(sel);
  let el;
  if ((el = on('[data-login]'))) {
    try {
      await busy(el, () => api.signIn(el.dataset.login));
    } catch (err) {
      renderLogin(errText(err));
    }
    return;
  }
  if ((el = on('[data-login-mode]'))) {
    LS.mode = el.dataset.loginMode;
    LS.confirmation = null;
    return renderLogin();
  }
  if ((el = on('[data-email-tab]'))) {
    const f = $('[data-form=email]');
    if (f) {
      LS.email = f.elements.email.value;
      if (f.elements.name) LS.name = f.elements.name.value;
    }
    LS.tab = el.dataset.emailTab;
    return renderLogin();
  }
  if ((el = on('[data-eye]'))) {
    const inp = el.parentElement.querySelector('input');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    el.textContent = show ? '🙈' : '👁️';
    el.setAttribute('aria-label', show ? 'Esconder senha' : 'Mostrar senha');
    return;
  }
  if (on('[data-forgot]')) {
    const email = $('[data-form=email] [name=email]')?.value.trim();
    if (!email) return renderLogin('Digite seu e-mail no campo acima e toque em "Esqueci a senha" de novo.');
    LS.email = email;
    try {
      await api.resetPassword(email);
      renderLogin();
      toast('Se esse e-mail tiver conta, mandamos um link para criar uma senha nova.', 'ok');
    } catch (err) {
      renderLogin(errText(err));
    }
    return;
  }
  if (on('[data-phone-again]')) {
    LS.confirmation = null;
    return renderLogin();
  }
  if ((el = on('[data-verified]'))) {
    try {
      const ok = await busy(el, () => api.checkVerified());
      if (!ok) renderVerify(pendingUser, 'Ainda não aparece como confirmado. Clique no link do e-mail e tente de novo.');
    } catch (err) {
      renderVerify(pendingUser, errText(err));
    }
    return;
  }
  if ((el = on('[data-resend]'))) {
    try {
      await busy(el, () => api.resendVerification());
      toast('Link mandado de novo!', 'ok');
    } catch (err) {
      renderVerify(pendingUser, errText(err));
    }
    return;
  }
  if (on('[data-logout]')) {
    await api.signOut();
    return;
  }
  if ((el = on('[data-join]'))) {
    el.disabled = true;
    try {
      const cid = await api.joinWithInvite(el.dataset.join, S.me.uid);
      location.hash = `#/c/${cid}`;
      toast('Você entrou no espaço! 🎉', 'ok');
    } catch (err) {
      el.disabled = false;
      toast(errText(err), 'error');
    }
    return;
  }
  if (on('[data-new]')) {
    return menuAt(on('[data-new]'), [
      { label: '👤 Conversar com alguém', onClick: newDmDialog },
      { label: '👥 Criar espaço', onClick: newSpaceDialog },
    ]);
  }
  if (on('[data-new-dm]')) return newDmDialog();
  if (on('[data-new-space]')) return newSpaceDialog();
  if (on('[data-back]')) {
    location.hash = '#/';
    return;
  }
  if (on('[data-theme-toggle]')) {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('pf_tema', next);
    } catch (_) {
      /* ok */
    }
    applyTheme();
    return;
  }
  if (on('[data-menu]')) {
    return menuAt(on('[data-menu]'), [
      { label: `${S.me.name} · ${S.me.email || S.me.phone}`, onClick: () => {} },
      ...(isStandalone() ? [] : [{ label: '📲 Instalar o app', onClick: installApp }]),
      {
        label: 'Sair da conta',
        onClick: async () => {
          await api.signOut();
          location.hash = '#/';
        },
      },
    ]);
  }
  if (on('[data-install]')) return installApp();
  if (on('[data-notif]')) {
    try {
      await Notification.requestPermission();
    } catch (_) {
      /* ok */
    }
    scheduleRender();
    return;
  }
  if ((el = on('.conv'))) {
    // deixa o link (#/c/id) abrir a conversa
    return;
  }
  if (on('[data-members]')) {
    S.showMembers = !S.showMembers;
    scheduleRender();
    return;
  }
  const c = currentConvo();
  if (calls.handleClick(t, c)) return;
  if (on('[data-invite]') && c) return inviteDialog(c.id);
  if (on('[data-edit-space]') && c) return editSpaceDialog(c);
  if (on('[data-leave]') && c) {
    if (await confirmBox('Sair do espaço?', `Você não vai mais ver as mensagens de “${c.name}”. Para voltar, precisa de um novo convite.`, 'Sair', true)) {
      try {
        await api.leaveSpace(c.id, S.me.uid);
        location.hash = '#/';
      } catch (err) {
        toast(errText(err), 'error');
      }
    }
    return;
  }
  if (on('[data-del-space]') && c) {
    if (await confirmBox('Excluir espaço?', `“${c.name}” e todas as mensagens serão apagados para todo mundo. Não dá para desfazer.`, 'Excluir', true)) {
      try {
        await api.deleteSpace(c.id);
        location.hash = '#/';
        toast('Espaço excluído.', 'ok');
      } catch (err) {
        toast(errText(err), 'error');
      }
    }
    return;
  }
  if ((el = on('[data-mem-menu]')) && c) {
    const uid = el.dataset.memMenu;
    const items = [{ label: '💬 Mandar mensagem', onClick: async () => (location.hash = `#/c/${await api.openDm(S.me.uid, uid)}`) }];
    if (isAdmin(c)) {
      if (!(c.admins || []).includes(uid)) items.push({ label: '⭐ Tornar admin', onClick: () => api.makeAdmin(c.id, uid).catch((er) => toast(errText(er), 'error')) });
      items.push({
        label: '🚪 Tirar do espaço',
        danger: true,
        onClick: async () => {
          if (await confirmBox('Tirar do espaço?', `${profile(uid).name} vai sair de “${c.name}”.`, 'Tirar', true)) api.removeMember(c.id, uid).catch((er) => toast(errText(er), 'error'));
        },
      });
    }
    return menuAt(el, items);
  }
  if ((el = on('[data-dm-menu]')) && c) {
    const o = otherOf(c);
    return menuAt(el, [
      iBlocked(o)
        ? { label: '✅ Desbloquear', onClick: () => api.setBlocked(S.me.uid, o, false) }
        : {
            label: '🚫 Bloquear',
            danger: true,
            onClick: async () => {
              if (await confirmBox('Bloquear esta pessoa?', `${profile(o).name} não vai mais conseguir te mandar mensagens. Você pode desbloquear depois.`, 'Bloquear', true)) {
                await api.setBlocked(S.me.uid, o, true);
                toast('Pessoa bloqueada.', 'ok');
              }
            },
          },
    ]);
  }
  if (on('[data-unblock]') && c) return api.setBlocked(S.me.uid, otherOf(c), false);
  if (on('[data-emoji]')) {
    const ta = $('.composer textarea');
    return emojiPicker(on('[data-emoji]'), (emo) => {
      const pos = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, pos) + emo + ta.value.slice(ta.selectionEnd ?? pos);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos + emo.length;
      autosize(ta);
    });
  }
  if (on('[data-reply-cancel]')) {
    S.replyTo = null;
    scheduleRender();
    return;
  }
  if (on('[data-older]') && c) {
    const oldest = S.older[0] || S.messages[0];
    try {
      const { messages, more } = await api.loadOlder(c.id, oldest);
      S.older = [...messages, ...S.older];
      S.hasMore = more;
      messages.forEach((m) => watchUser(m.by));
      keepScrollOnOlder = true;
      renderMessages();
    } catch (err) {
      toast(errText(err), 'error');
    }
    return;
  }
  if ((el = on('[data-jump]'))) {
    const target = $(`[data-mid="${CSS.escape(el.dataset.jump)}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1400);
    }
    return;
  }
  if (on('[data-attach]')) {
    fileInput.value = '';
    fileInput.click();
    return;
  }
  if (on('[data-record]')) return startRecording();
  if (on('[data-rec-cancel]')) return stopRecording(false);
  if (on('[data-rec-send]')) return stopRecording(true);
  const msgEl = t.closest('[data-mid]');
  if (!msgEl || !c) return;
  const m = findMessage(msgEl.dataset.mid);
  if (!m) return;
  if (m.file && on('[data-open-img]')) {
    if (FILE_CACHE.has(m.file.id)) openImage(m);
    return;
  }
  if (m.file && (el = on('[data-load-file]'))) {
    el.disabled = true;
    el.querySelector('small') && (el.querySelector('small').textContent = 'carregando…');
    try {
      await getFileUrl(c.id, m.file);
      lastMessagesHtml = '';
      renderMessages();
      const media = $(`[data-mid="${CSS.escape(m.id)}"] video, [data-mid="${CSS.escape(m.id)}"] audio`);
      if (media) media.play().catch(() => {});
    } catch (err) {
      el.disabled = false;
      toast(errText(err), 'error');
    }
    return;
  }
  if (m.file && (el = on('[data-download]'))) {
    el.disabled = true;
    el.textContent = 'Baixando…';
    try {
      downloadUrl(await getFileUrl(c.id, m.file), m.file.name);
    } catch (err) {
      toast(errText(err), 'error');
    }
    el.disabled = false;
    el.textContent = 'Baixar';
    return;
  }
  // celular/tablet: tocar na mensagem mostra os botões (reagir, responder…)
  if (!t.closest('button, a, textarea, input, video, audio') && matchMedia('(hover: none)').matches) {
    S.tapped = S.tapped === m.id ? null : m.id;
    document.querySelectorAll('.msg.tapped').forEach((x) => x.classList.remove('tapped'));
    if (S.tapped) msgEl.classList.add('tapped');
    lastMessagesHtml = '';
    return;
  }
  if ((el = on('[data-react]'))) {
    const emo = el.dataset.react;
    const has = (m.reactions && m.reactions[emo] || []).includes(S.me.uid);
    api.toggleReaction(c.id, m.id, emo, S.me.uid, !has).catch((er) => toast(errText(er), 'error'));
    return;
  }
  if ((el = on('[data-react-more]'))) {
    return emojiPicker(el, (emo) => {
      const has = (m.reactions && m.reactions[emo] || []).includes(S.me.uid);
      api.toggleReaction(c.id, m.id, emo, S.me.uid, !has).catch((er) => toast(errText(er), 'error'));
    });
  }
  if (on('[data-reply]')) {
    S.replyTo = { id: m.id, by: m.by, text: m.text || api.fileLabel(m.file) };
    scheduleRender();
    setTimeout(() => $('.composer textarea')?.focus(), 30);
    return;
  }
  if (on('[data-edit]')) {
    S.editing = m.id;
    lastMessagesHtml = '';
    renderMessages();
    const ta = $('[data-edit-form] textarea');
    if (ta) {
      ta.focus();
      ta.selectionStart = ta.value.length;
    }
    return;
  }
  if (on('[data-edit-cancel]')) {
    S.editing = null;
    lastMessagesHtml = '';
    renderMessages();
    return;
  }
  if (on('[data-del]')) {
    if (await confirmBox('Apagar mensagem?', 'A mensagem vai sumir para todo mundo.', 'Apagar', true)) api.deleteMessage(c.id, m.id, m.file || null).catch((er) => toast(errText(er), 'error'));
    return;
  }
  if (on('[data-report]')) return reportDialog(m);
});

app.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.matches('[data-send]')) {
    e.preventDefault();
    return send(f);
  }
  if (f.matches('[data-edit-form]')) {
    e.preventDefault();
    const text = $('textarea', f).value.trim();
    const mid = S.editing;
    if (!text) return toast('A mensagem não pode ficar vazia. Para tirar, use Apagar.', 'error');
    S.editing = null;
    lastMessagesHtml = '';
    try {
      await api.editMessage(S.current, mid, text);
    } catch (err) {
      toast(errText(err), 'error');
    }
    renderMessages();
  }
});

app.addEventListener('keydown', (e) => {
  const ta = e.target.closest('.composer textarea, [data-edit-form] textarea');
  if (!ta) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    ta.form.requestSubmit();
  } else if (e.key === 'Escape' && S.editing) {
    S.editing = null;
    lastMessagesHtml = '';
    renderMessages();
  } else if (e.key === 'ArrowUp' && ta.matches('.composer textarea') && !ta.value) {
    // seta para cima edita a sua última mensagem
    const mine = [...S.messages].reverse().find((m) => m.by === S.me.uid && !m.deleted);
    if (mine) {
      e.preventDefault();
      S.editing = mine.id;
      lastMessagesHtml = '';
      renderMessages();
      $('[data-edit-form] textarea')?.focus();
    }
  }
});

app.addEventListener('input', (e) => {
  if (e.target.matches('.composer textarea')) {
    autosize(e.target);
    if (e.target.value) onTypingInput();
  }
  if (e.target.matches('[data-search]')) {
    S.search = e.target.value;
    const pos = e.target.selectionStart;
    $('.sidebar').innerHTML = sidebarHtml();
    const s = $('[data-search]');
    s.focus();
    s.selectionStart = s.selectionEnd = pos;
  }
});

// ================================================================= rotas
function route() {
  if (!S.me) return;
  const h = location.hash.replace(/^#/, '');
  let m;
  if ((m = h.match(/^\/convite\/([a-z0-9]{6,20})$/))) {
    openConversation(null);
    lastShellKey = '';
    showInvite(m[1]);
    return;
  }
  if ((m = h.match(/^\/c\/([\w-]{3,80})$/))) {
    if (!$('.shell')) lastShellKey = '';
    openConversation(m[1]);
    return;
  }
  if (!$('.shell')) lastShellKey = '';
  openConversation(null);
}
window.addEventListener('hashchange', route);

// avisos de mensagem nova
function checkNewMessages(list) {
  for (const c of list) {
    const before = S.lastSeenAt.get(c.id);
    S.lastSeenAt.set(c.id, c.lastMessageAt || 0);
    if (before === undefined) continue;
    if ((c.lastMessageAt || 0) <= before || !c.lastMessage || c.lastMessage.by === S.me.uid) continue;
    if ((c.lastMessage.at || c.lastMessageAt) < S.startedAt) continue;
    const viewing = c.id === S.current && !document.hidden;
    if (viewing) continue;
    ding();
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        const n = new Notification(convoName(c), { body: `${c.type === 'space' ? profile(c.lastMessage.by).name.split(' ')[0] + ': ' : ''}${c.lastMessage.text}`, tag: c.id });
        n.onclick = () => {
          window.focus();
          location.hash = `#/c/${c.id}`;
          n.close();
        };
      } catch (_) {
        /* ok */
      }
    }
  }
}

// ================================================================= começar
let convUnsub = null;
let presenceTimer = null;
function startSession(user) {
  S.me = user;
  S.startedAt = Date.now();
  api.ensureProfile(user).catch((err) => toast(errText(err), 'error'));
  watchUser(user.uid);
  convUnsub = api.watchConversations(
    user.uid,
    (list) => {
      S.convos = list;
      S.convosLoaded = true;
      for (const c of list) {
        for (const u of c.members) if (c.type === 'dm' || c.id === S.current) watchUser(u);
        if (c.call) for (const u of [c.call.by, ...c.call.people]) watchUser(u);
      }
      const cur = currentConvo();
      if (cur) for (const u of cur.members) watchUser(u);
      checkNewMessages(list);
      if (cur) markReadSoon();
      if (!/^#\/convite\//.test(location.hash)) scheduleRender();
      calls.onConvos();
    },
    (err) => toast(errText(err), 'error')
  );
  const beat = () => !document.hidden && api.touchPresence(user.uid);
  presenceTimer = setInterval(beat, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      beat();
      markReadSoon();
    } else stopTyping();
  });
  // atualiza "digitando…" e "visto há…" de tempos em tempos
  setInterval(() => S.me && $('.shell') && scheduleRender(), 4000);
  route();
}

function endSession() {
  stopRecording(false);
  calls.hangUp();
  if (convUnsub) convUnsub();
  if (S.msgUnsub) S.msgUnsub();
  clearInterval(presenceTimer);
  S.profileSubs.forEach((u) => u());
  S.profileSubs.clear();
  Object.assign(S, { me: null, myProfile: null, convos: [], convosLoaded: false, current: null, messages: [], older: [] });
  S.profiles.clear();
  lastShellKey = '';
}

if (!api.isConfigured) renderSetup();
else
  api.onUser((user) => {
    const wasIn = !!S.me || !!pendingUser;
    if (user && user.needsVerify) {
      if (S.me) endSession();
      pendingUser = user;
      renderVerify(user);
      return;
    }
    pendingUser = null;
    if (user) {
      if (!S.me || S.me.uid !== user.uid) {
        if (S.me) endSession();
        startSession(user);
      } else if (user.name !== S.me.name) {
        // nome novo (acabou de criar a conta)
        S.me = user;
        api.ensureProfile(user).catch(() => {});
        scheduleRender();
      }
    } else {
      if (S.me) endSession();
      LS.confirmation = null;
      if (wasIn) {
        LS.mode = 'home';
        LS.tab = 'in';
      }
      renderLogin();
    }
  });
