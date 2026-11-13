// Ligação com o Firebase (login com Google + banco Firestore em tempo real).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut as fbSignOut,
  OAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limitToLast,
  endBefore,
  getDocs,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  writeBatch,
  deleteField,
  Bytes,
  getDocFromCache,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import * as cfg from './config.js';
const { firebaseConfig } = cfg;
/** Servidores extras para chamadas (TURN), se você criar uma conta num serviço de ponte. */
export const extraIceServers = Array.isArray(cfg.iceServers) ? cfg.iceServers : [];
/** Avisos no celular (Web Push). */
export const pushServer = typeof cfg.pushServer === 'string' ? cfg.pushServer.replace(/\/$/, '') : '';
/** Endereço que entrega as senhas da ponte (TURN) da Metered, se configurado. */
export const turnCredentialsUrl = typeof cfg.turnCredentialsUrl === 'string' ? cfg.turnCredentialsUrl.trim() : '';

export const phoneEnabled = cfg.phoneLogin === true;
export const isConfigured = !!(firebaseConfig && firebaseConfig.apiKey && !/COLE/.test(firebaseConfig.apiKey));

let app, auth, db;
if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  auth.languageCode = 'pt';
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (_) {
    db = initializeFirestore(app, {});
  }
}

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : typeof t === 'number' ? t : t ? Date.parse(t) || 0 : 0);
const toMessage = (d) => {
  const m = d.data({ serverTimestamps: 'estimate' });
  return { id: d.id, ...m, at: ms(m.at), editedAt: ms(m.editedAt) || null, _snap: d };
};
const toConversation = (d) => {
  const c = d.data({ serverTimestamps: 'estimate' });
  const reads = {};
  for (const [k, v] of Object.entries(c.reads || {})) reads[k] = ms(v);
  const typing = {};
  for (const [k, v] of Object.entries(c.typing || {})) typing[k] = ms(v);
  return {
    id: d.id,
    ...c,
    reads,
    typing,
    lastMessageAt: ms(c.lastMessageAt) || ms(c.createdAt),
    lastMessage: c.lastMessage ? { ...c.lastMessage, at: ms(c.lastMessage.at) } : null,
    call: c.call && c.call.id ? { ...c.call, startedAt: ms(c.call.startedAt) || Date.now(), people: c.call.people || [], seen: c.call.seen || [], declined: c.call.declined || [] } : null,
  };
};

// ------------------------------------------------------------------ conta
const OAUTH = ['google.com', 'microsoft.com', 'yahoo.com'];
function mapUser(u) {
  const providers = u.providerData.map((p) => p.providerId);
  const email = (u.email || '').toLowerCase();
  const phone = u.phoneNumber || '';
  // e-mail confiável: confirmado ou vindo do Google/Microsoft/Yahoo
  const trusted = !!email && (u.emailVerified || providers.some((p) => OAUTH.includes(p)));
  const fallback = email ? email.split('@')[0] : phone ? `Pessoa ${phone.slice(-4)}` : 'Pessoa';
  return {
    uid: u.uid,
    name: (u.displayName || fallback).slice(0, 80),
    email: trusted ? email : '',
    rawEmail: email,
    phone,
    photo: u.photoURL || '',
    needsVerify: !!email && !trusted && !phone,
  };
}

let userCb = null;
export function onUser(cb) {
  if (!isConfigured) return cb(null);
  userCb = cb;
  getRedirectResult(auth).catch(() => {});
  return onAuthStateChanged(auth, (u) => cb(u ? mapUser(u) : null));
}
const refreshUser = () => auth.currentUser && userCb && userCb(mapUser(auth.currentUser));

/** Traduz os erros do login para português. */
export function authError(err) {
  const c = (err && err.code) || '';
  const m = {
    'auth/invalid-email': 'Esse e-mail não parece certo.',
    'auth/missing-password': 'Digite a senha.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/email-already-in-use': 'Já existe uma conta com esse e-mail. Use "Entrar" (ou o mesmo jeito que você usou da outra vez, como Google).',
    'auth/invalid-credential': 'E-mail ou senha errados.',
    'auth/wrong-password': 'E-mail ou senha errados.',
    'auth/user-not-found': 'Não achamos uma conta com esse e-mail.',
    'auth/too-many-requests': 'Muitas tentativas. Espere alguns minutos e tente de novo.',
    'auth/account-exists-with-different-credential': 'Esse e-mail já entrou de outro jeito antes (por exemplo, pelo Google). Entre do mesmo jeito da primeira vez.',
    'auth/operation-not-allowed': 'Esse jeito de entrar ainda não foi ligado no Firebase (Authentication → Método de login).',
    'auth/unauthorized-domain': 'Este endereço ainda não foi liberado no Firebase. Adicione o domínio do site em Authentication → Configurações → Domínios autorizados.',
    'auth/invalid-phone-number': 'Número de telefone inválido. Use o DDD, por exemplo: (62) 99999-9999.',
    'auth/missing-phone-number': 'Digite o número do celular.',
    'auth/invalid-verification-code': 'Código errado. Confira o SMS e tente de novo.',
    'auth/code-expired': 'Esse código venceu. Peça um novo.',
    'auth/quota-exceeded': 'O limite de SMS de hoje acabou. Tente amanhã ou entre de outro jeito.',
    'auth/billing-not-enabled': 'O login por telefone precisa do plano Blaze ligado no Firebase.',
    'auth/captcha-check-failed': 'A verificação "não sou um robô" falhou. Recarregue a página e tente de novo.',
    'auth/network-request-failed': 'Sem internet. Confira a conexão e tente de novo.',
    'auth/popup-blocked': 'O navegador bloqueou a janelinha de login. Libere os pop-ups deste site.',
  };
  return m[c] || (err && err.message) || 'Não foi possível entrar. Tente de novo.';
}
const fail = (err) => {
  throw new Error(authError(err));
};

function providerFor(kind) {
  if (kind === 'microsoft') {
    const p = new OAuthProvider('microsoft.com');
    p.setCustomParameters({ prompt: 'select_account' });
    return p;
  }
  if (kind === 'yahoo') {
    const p = new OAuthProvider('yahoo.com');
    p.addScope('email');
    p.addScope('profile');
    return p;
  }
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
}

/** Entrar com Google, Microsoft ou Yahoo. */
export async function signIn(kind = 'google') {
  const provider = providerFor(kind);
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
    fail(err);
  }
}

export async function signUpEmail(name, email, password) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(cred.user, { displayName: name.trim().slice(0, 80) });
    await sendEmailVerification(cred.user).catch(() => {});
    refreshUser();
  } catch (err) {
    fail(err);
  }
}

export async function signInEmail(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  } catch (err) {
    fail(err);
  }
}

export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (err) {
    if (err && err.code === 'auth/user-not-found') return; // não conta se o e-mail existe
    fail(err);
  }
}

export async function resendVerification() {
  try {
    if (auth.currentUser) await sendEmailVerification(auth.currentUser);
  } catch (err) {
    fail(err);
  }
}

/** Depois de clicar no link do e-mail: confere de novo. Devolve true se já confirmou. */
export async function checkVerified() {
  if (!auth.currentUser) return false;
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
  refreshUser();
  return !!auth.currentUser.emailVerified;
}

let recaptcha = null;
/** Manda o SMS. `holder` é o elemento onde fica o "não sou um robô" invisível. */
export async function sendPhoneCode(phone, holder) {
  try {
    if (!recaptcha) recaptcha = new RecaptchaVerifier(auth, holder, { size: 'invisible' });
    return await signInWithPhoneNumber(auth, phone, recaptcha);
  } catch (err) {
    try {
      recaptcha && recaptcha.clear();
    } catch (_) {
      /* ok */
    }
    recaptcha = null;
    fail(err);
  }
}

export async function confirmPhoneCode(confirmation, code, name) {
  try {
    const cred = await confirmation.confirm(code.trim());
    if (!cred.user.displayName && name && name.trim()) {
      await updateProfile(cred.user, { displayName: name.trim().slice(0, 80) });
      refreshUser();
    }
  } catch (err) {
    fail(err);
  }
}

export const signOut = () => fbSignOut(auth);

/** Cria/atualiza o perfil (nome, foto, e-mail) e o índice de e-mail para acharem você. */
export async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  const base = { name: user.name.slice(0, 80), photo: user.photo || '', email: user.email || '', phone: user.phone || '', lastActive: serverTimestamp() };
  if (snap.exists()) await updateDoc(ref, base);
  else await setDoc(ref, { ...base, createdAt: serverTimestamp(), blocked: [] });
  if (user.email) await setDoc(doc(db, 'emails', user.email), { uid: user.uid });
  if (user.phone) await setDoc(doc(db, 'phones', user.phone), { uid: user.uid });
}

export function touchPresence(uid) {
  return updateDoc(doc(db, 'users', uid), { lastActive: serverTimestamp() }).catch(() => {});
}

export function watchProfile(uid, cb) {
  return onSnapshot(
    doc(db, 'users', uid),
    (s) => {
      if (!s.exists()) return cb(null);
      const p = s.data({ serverTimestamps: 'estimate' });
      cb({ uid, name: p.name, photo: p.photo, email: p.email, phone: p.phone || '', lastActive: ms(p.lastActive), blocked: p.blocked || [] });
    },
    () => cb(null)
  );
}

/** Celular no formato +5562999999999 (aceita com ou sem +55, espaços, traços). */
export function normalizePhone(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return '+' + d.slice(1).replace(/\D/g, '');
  d = d.replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d ? '+' + d : '';
}

export async function findUserByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || e.includes('/') || e.length > 200) return null;
  const s = await getDoc(doc(db, 'emails', e));
  return s.exists() ? s.data().uid : null;
}

export async function findUserByPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  const s = await getDoc(doc(db, 'phones', p));
  return s.exists() ? s.data().uid : null;
}

export function setBlocked(uid, otherUid, blocked) {
  return updateDoc(doc(db, 'users', uid), { blocked: blocked ? arrayUnion(otherUid) : arrayRemove(otherUid) });
}

// ------------------------------------------------------------------ conversas
export function watchConversations(uid, cb, onError) {
  const q = query(collection(db, 'conversations'), where('members', 'array-contains', uid));
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toConversation)),
    (err) => onError && onError(err)
  );
}

export function dmId(a, b) {
  const [x, y] = [a, b].sort();
  return `dm_${x}_${y}`;
}

export async function openDm(uid, otherUid) {
  const id = dmId(uid, otherUid);
  const ref = doc(db, 'conversations', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const members = [uid, otherUid].sort();
    await setDoc(ref, { type: 'dm', members, createdBy: uid, createdAt: serverTimestamp(), lastMessageAt: serverTimestamp(), reads: {}, typing: {} });
  }
  return id;
}

export async function createSpace(uid, { name, emoji, description }) {
  const ref = doc(collection(db, 'conversations'));
  await setDoc(ref, {
    type: 'space',
    name: name.slice(0, 60),
    emoji: emoji || '💬',
    description: (description || '').slice(0, 200),
    members: [uid],
    admins: [uid],
    createdBy: uid,
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    reads: {},
    typing: {},
  });
  return ref.id;
}

export function updateSpace(cid, fields) {
  const clean = {};
  if (fields.name != null) clean.name = String(fields.name).slice(0, 60);
  if (fields.emoji != null) clean.emoji = String(fields.emoji).slice(0, 8);
  if (fields.description != null) clean.description = String(fields.description).slice(0, 200);
  return updateDoc(doc(db, 'conversations', cid), clean);
}

export async function leaveSpace(cid, uid) {
  const ref = doc(db, 'conversations', cid);
  const s = await getDoc(ref);
  if (!s.exists()) return;
  const c = s.data();
  const members = (c.members || []).filter((x) => x !== uid);
  let admins = (c.admins || []).filter((x) => x !== uid);
  const wasAdmin = (c.admins || []).includes(uid);
  // última pessoa saindo: o espaço é apagado
  if (!members.length && wasAdmin) return deleteSpace(cid);
  // último admin saindo: a pessoa mais antiga vira admin
  if (wasAdmin && !admins.length) admins = [members[0]];
  return updateDoc(ref, { members, admins });
}

export function removeMember(cid, uid) {
  return updateDoc(doc(db, 'conversations', cid), { members: arrayRemove(uid), admins: arrayRemove(uid) });
}

export function makeAdmin(cid, uid) {
  return updateDoc(doc(db, 'conversations', cid), { admins: arrayUnion(uid) });
}

export async function deleteSpace(cid) {
  // apaga as mensagens (e os pedaços dos arquivos delas) em lotes e depois o espaço
  for (;;) {
    const s = await getDocs(query(collection(db, 'conversations', cid, 'messages'), orderBy('at'), limitToLast(100)));
    if (s.empty) break;
    let b = writeBatch(db);
    let ops = 0;
    const add = async (ref) => {
      b.delete(ref);
      if (++ops >= 450) {
        await b.commit();
        b = writeBatch(db);
        ops = 0;
      }
    };
    for (const d of s.docs) {
      const f = d.data().file;
      if (f && f.id) for (let i = 0; i < (f.chunks || 0); i++) await add(doc(db, 'conversations', cid, 'chunks', `${f.id}_${i}`));
      await add(d.ref);
    }
    await b.commit();
    if (s.size < 100) break;
  }
  await deleteDoc(doc(db, 'conversations', cid));
}

export function markRead(cid, uid) {
  return updateDoc(doc(db, 'conversations', cid), { [`reads.${uid}`]: serverTimestamp() }).catch(() => {});
}

export function setTyping(cid, uid, on) {
  return updateDoc(doc(db, 'conversations', cid), { [`typing.${uid}`]: on ? serverTimestamp() : deleteField() }).catch(() => {});
}

// ------------------------------------------------------------------ convites
function randomCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(a, (x) => abc[x % abc.length]).join('');
}

export async function createInvite(cid, uid, { name, emoji }) {
  const code = randomCode();
  await setDoc(doc(db, 'invites', code), { cid, name, emoji: emoji || '💬', by: uid, at: serverTimestamp() });
  return code;
}

export async function getInvite(code) {
  const s = await getDoc(doc(db, 'invites', code));
  return s.exists() ? { code, ...s.data() } : null;
}

export async function joinWithInvite(code, uid) {
  const inv = await getInvite(code);
  if (!inv) throw new Error('Este convite não existe mais.');
  try {
    await updateDoc(doc(db, 'conversations', inv.cid), { members: arrayUnion(uid), joinCode: code });
  } catch (err) {
    // já é membro: a regra recusa "entrar de novo", mas está tudo certo
    const s = await getDoc(doc(db, 'conversations', inv.cid)).catch(() => null);
    if (!(s && s.exists() && (s.data().members || []).includes(uid))) throw new Error('Não foi possível entrar neste espaço. O convite pode ter sido apagado.');
  }
  return inv.cid;
}

// ------------------------------------------------------------------ mensagens
const PAGE = 50;

export function watchMessages(cid, cb, onError) {
  const q = query(collection(db, 'conversations', cid, 'messages'), orderBy('at'), limitToLast(PAGE));
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toMessage), s.docs.length >= PAGE),
    (err) => onError && onError(err)
  );
}

export async function loadOlder(cid, oldest) {
  if (!oldest || !oldest._snap) return { messages: [], more: false };
  const s = await getDocs(query(collection(db, 'conversations', cid, 'messages'), orderBy('at'), endBefore(oldest._snap), limitToLast(PAGE)));
  return { messages: s.docs.map(toMessage), more: s.docs.length >= PAGE };
}

export function fileLabel(f) {
  if (!f) return '';
  return { image: '📷 Foto', video: '🎬 Vídeo', audio: '🎤 Áudio' }[f.kind] || `📎 ${f.name || 'Arquivo'}`;
}

export async function sendMessage(cid, uid, text, replyTo, file) {
  const ref = doc(collection(db, 'conversations', cid, 'messages'));
  const b = writeBatch(db);
  const msg = { text, by: uid, at: serverTimestamp() };
  if (replyTo) msg.replyTo = { id: replyTo.id, by: replyTo.by, text: String(replyTo.text || '').slice(0, 140) };
  if (file) msg.file = file;
  b.set(ref, msg);
  const preview = text ? (file ? `${fileLabel(file).split(' ')[0]} ${text}` : text) : fileLabel(file);
  b.update(doc(db, 'conversations', cid), {
    lastMessage: { text: preview.slice(0, 140), by: uid, at: serverTimestamp() },
    lastMessageAt: serverTimestamp(),
    [`reads.${uid}`]: serverTimestamp(),
    [`typing.${uid}`]: deleteField(),
  });
  await b.commit();
  notifyOthers(cid, 'msg', preview);
}

export function editMessage(cid, mid, text) {
  return updateDoc(doc(db, 'conversations', cid, 'messages', mid), { text, editedAt: serverTimestamp() });
}

export async function deleteMessage(cid, mid, file) {
  const b = writeBatch(db);
  const upd = { text: '', deleted: true, editedAt: serverTimestamp() };
  if (file) {
    upd.file = deleteField();
    for (let i = 0; i < (file.chunks || 0); i++) b.delete(doc(db, 'conversations', cid, 'chunks', `${file.id}_${i}`));
  }
  b.update(doc(db, 'conversations', cid, 'messages', mid), upd);
  await b.commit();
}

// ------------------------------------------------------------------ arquivos
// O Firebase grátis não tem mais "Storage", então os arquivos ficam no próprio banco,
// divididos em pedaços de até 900 KB.
const CHUNK = 900 * 1024;
export const FILE_LIMIT = 10 * 1024 * 1024;

export async function uploadFile(cid, uid, blob, onProgress) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (buf.length > FILE_LIMIT) throw new Error('O arquivo é grande demais (máximo 10 MB).');
  const fid = doc(collection(db, 'conversations', cid, 'chunks')).id;
  const n = Math.max(1, Math.ceil(buf.length / CHUNK));
  let done = 0;
  try {
    for (let i = 0; i < n; i++) {
      const part = buf.slice(i * CHUNK, (i + 1) * CHUNK);
      await setDoc(doc(db, 'conversations', cid, 'chunks', `${fid}_${i}`), { fid, i, by: uid, d: Bytes.fromUint8Array(part) });
      done = i + 1;
      if (onProgress) onProgress((i + 1) / n);
    }
  } catch (err) {
    for (let i = 0; i < done; i++) deleteDoc(doc(db, 'conversations', cid, 'chunks', `${fid}_${i}`)).catch(() => {});
    throw err;
  }
  return { id: fid, chunks: n, size: buf.length };
}

export async function loadFile(cid, f) {
  const parts = await Promise.all(
    Array.from({ length: f.chunks }, (_, i) => {
      const r = doc(db, 'conversations', cid, 'chunks', `${f.id}_${i}`);
      return getDocFromCache(r)
        .then((s) => (s.exists() ? s : getDoc(r)))
        .catch(() => getDoc(r));
    })
  );
  if (parts.some((p) => !p.exists())) throw new Error('Este arquivo não está mais disponível.');
  return new Blob(
    parts.map((p) => p.data().d.toUint8Array()),
    { type: f.type || 'application/octet-stream' }
  );
}

export function toggleReaction(cid, mid, emoji, uid, on) {
  return updateDoc(doc(db, 'conversations', cid, 'messages', mid), { [`reactions.${emoji}`]: on ? arrayUnion(uid) : arrayRemove(uid) });
}

export function report(data) {
  const ref = doc(collection(db, 'reports'));
  return setDoc(ref, { ...data, at: serverTimestamp() });
}

// ------------------------------------------------------------------ chamadas (voz e vídeo)
// O "toque" fica na própria conversa (campo call). A conversa entre os aparelhos
// (WebRTC) troca os recados de conexão em conversations/{cid}/calls/{id}/signals.
const convRef = (cid) => doc(db, 'conversations', cid);
const callLabel = (kind) => (kind === 'video' ? 'Chamada de vídeo' : 'Chamada de voz');

/** Começa uma chamada (ou entra na que já está acontecendo). Devolve { id, kind, people }. */
export async function callStart(cid, uid, kind) {
  const r = await callStartTx(cid, uid, kind);
  if (!r.joined) notifyOthers(cid, 'call');
  return r;
}
const DEAD_MS = 60 * 1000;
/** A chamada ainda tem alguém de verdade? (cada pessoa avisa "estou aqui" a cada 15 s) */
async function callAlive(tx, cid, call) {
  if (!call || !call.id || !(call.people || []).length) return false;
  if (Date.now() - (ms(call.startedAt) || Date.now()) < DEAD_MS) return true;
  const b = await tx.get(doc(db, 'conversations', cid, 'calls', call.id));
  const beats = b.exists() ? b.data().beats || {} : {};
  return call.people.some((u) => Date.now() - (ms(beats[u]) || 0) < DEAD_MS);
}

function callStartTx(cid, uid, kind) {
  return runTransaction(db, async (tx) => {
    const s = await tx.get(convRef(cid));
    const c = s.data() || {};
    if (await callAlive(tx, cid, c.call)) {
      tx.update(convRef(cid), { 'call.people': arrayUnion(uid), 'call.seen': arrayUnion(uid) });
      return { id: c.call.id, kind: c.call.kind, people: (c.call.people || []).filter((x) => x !== uid), joined: true };
    }
    const id = doc(collection(db, 'conversations', cid, 'calls')).id;
    tx.update(convRef(cid), { call: { id, kind: kind === 'video' ? 'video' : 'audio', by: uid, startedAt: serverTimestamp(), people: [uid], seen: [uid], declined: [] } });
    return { id, kind, people: [], joined: false };
  });
}

/** Entra numa chamada que já existe. Devolve quem já está nela. */
export async function callJoin(cid, callId, uid) {
  const r = await callJoinTx(cid, callId, uid);
  if (r.ended) throw new Error('Essa chamada já acabou.');
  return r;
}
function callJoinTx(cid, callId, uid) {
  return runTransaction(db, async (tx) => {
    const s = await tx.get(convRef(cid));
    const call = (s.data() || {}).call;
    if (!call || call.id !== callId) throw new Error('Essa chamada já acabou.');
    if (!(await callAlive(tx, cid, call))) {
      // ficou "presa" (todo mundo fechou o app sem desligar): limpa
      tx.update(convRef(cid), { call: deleteField() });
      return { ended: true };
    }
    tx.update(convRef(cid), { 'call.people': arrayUnion(uid), 'call.seen': arrayUnion(uid) });
    return { id: call.id, kind: call.kind, people: (call.people || []).filter((x) => x !== uid) };
  });
}

/** Sai da chamada. Quem sai por último encerra e deixa o aviso na conversa. */
export async function callLeave(cid, callId, uid) {
  await runTransaction(db, async (tx) => {
    const s = await tx.get(convRef(cid));
    const call = (s.data() || {}).call;
    if (!call || call.id !== callId) return;
    const people = (call.people || []).filter((x) => x !== uid);
    if (people.length) {
      tx.update(convRef(cid), { 'call.people': people });
      return;
    }
    const startedAt = ms(call.startedAt) || Date.now();
    const missed = (call.seen || []).length <= 1;
    const dur = missed ? 0 : Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const text = missed ? '📞 Chamada não atendida' : `📞 ${callLabel(call.kind)}`;
    const mref = doc(collection(db, 'conversations', cid, 'messages'));
    tx.set(mref, { text, by: uid, at: serverTimestamp(), sys: 'call', callInfo: { kind: call.kind === 'video' ? 'video' : 'audio', dur, missed, starter: call.by || uid } });
    tx.update(convRef(cid), {
      call: deleteField(),
      lastMessage: { text, by: uid, at: serverTimestamp() },
      lastMessageAt: serverTimestamp(),
    });
  });
}

export function callDecline(cid, callId, uid) {
  return updateDoc(convRef(cid), { 'call.declined': arrayUnion(uid) }).catch(() => {});
}

/** Tira da chamada alguém que fechou o app sem desligar. */
export function callDropGhost(cid, callId, ghost) {
  return updateDoc(convRef(cid), { 'call.people': arrayRemove(ghost) }).catch(() => {});
}

/** "Ainda estou aqui" a cada 15 segundos. */
export function callBeat(cid, callId, uid) {
  return setDoc(doc(db, 'conversations', cid, 'calls', callId), { beats: { [uid]: serverTimestamp() } }, { merge: true }).catch(() => {});
}

export function watchCall(cid, callId, cb) {
  return onSnapshot(
    doc(db, 'conversations', cid, 'calls', callId),
    (s) => {
      const beats = {};
      const d = s.exists() ? s.data({ serverTimestamps: 'estimate' }) : {};
      for (const [k, v] of Object.entries(d.beats || {})) beats[k] = ms(v);
      cb(beats);
    },
    () => {}
  );
}

let sigSeq = 0;
export function sendSignal(cid, callId, from, to, type, data) {
  return setDoc(doc(collection(db, 'conversations', cid, 'calls', callId, 'signals')), { from, to, type, data: String(data), at: Date.now() * 1000 + (sigSeq++ % 1000) });
}

export function watchSignals(cid, callId, uid, cb) {
  const q = query(collection(db, 'conversations', cid, 'calls', callId, 'signals'), where('to', '==', uid));
  return onSnapshot(
    q,
    (s) => {
      const added = s
        .docChanges()
        .filter((ch) => ch.type === 'added')
        .map((ch) => ({ id: ch.doc.id, ...ch.doc.data() }))
        .sort((a, b) => a.at - b.at);
      if (added.length) cb(added);
    },
    () => {}
  );
}

export function deleteSignal(cid, callId, sid) {
  return deleteDoc(doc(db, 'conversations', cid, 'calls', callId, 'signals', sid)).catch(() => {});
}

// ------------------------------------------------------------------ avisos no celular (app fechado)
/** Chave pública do carteiro (vem do servidor). */
export async function getPushKey() {
  if (!pushServer) return '';
  try {
    const r = await fetch(`${pushServer}/status`, { cache: 'no-store' });
    const j = await r.json();
    if (j && j.publicKey) {
      try {
        localStorage.setItem('pf_push_key', j.publicKey);
      } catch (_) {
        /* ok */
      }
      return j.publicKey;
    }
  } catch (_) {
    /* servidor dormindo ou sem internet */
  }
  try {
    return localStorage.getItem('pf_push_key') || '';
  } catch (_) {
    return '';
  }
}
/** Guarda a "caixa de correio" deste aparelho (até 10 aparelhos por pessoa). */
export async function savePushSub(uid, sub) {
  const ref = doc(db, 'pushSubs', uid);
  const s = await getDoc(ref).catch(() => null);
  const old = s && s.exists() ? s.data().subs || [] : [];
  if (old.some((x) => x.endpoint === sub.endpoint && x.p256dh === sub.p256dh)) return;
  const subs = [...old.filter((x) => x.endpoint !== sub.endpoint), sub].slice(-10);
  await setDoc(ref, { subs });
}

export async function removePushSub(uid, endpoint) {
  const ref = doc(db, 'pushSubs', uid);
  const s = await getDoc(ref).catch(() => null);
  if (!s || !s.exists()) return;
  await setDoc(ref, { subs: (s.data().subs || []).filter((x) => x.endpoint !== endpoint) });
}

/** Pede para o carteiro avisar os outros membros da conversa. */
export async function notifyOthers(cid, kind, text) {
  if (!pushServer || !auth.currentUser) return;
  try {
    const token = await auth.currentUser.getIdToken();
    await fetch(`${pushServer}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cid, kind, text: String(text || '').slice(0, 140) }),
      keepalive: true,
    });
  } catch (_) {
    /* sem aviso, tudo bem */
  }
}
