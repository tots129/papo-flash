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
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';

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
  };
};

// ------------------------------------------------------------------ conta
export function onUser(cb) {
  if (!isConfigured) return cb(null);
  getRedirectResult(auth).catch(() => {});
  return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, name: u.displayName || u.email.split('@')[0], email: (u.email || '').toLowerCase(), photo: u.photoURL || '' } : null));
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
    if (err && err.code === 'auth/unauthorized-domain') {
      throw new Error('Este endereço ainda não foi liberado no Firebase. Adicione o domínio do site em Authentication → Configurações → Domínios autorizados.');
    }
    throw err;
  }
}

export const signOut = () => fbSignOut(auth);

/** Cria/atualiza o perfil (nome, foto, e-mail) e o índice de e-mail para acharem você. */
export async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  const base = { name: user.name.slice(0, 80), photo: user.photo || '', email: user.email, lastActive: serverTimestamp() };
  if (snap.exists()) await updateDoc(ref, base);
  else await setDoc(ref, { ...base, createdAt: serverTimestamp(), blocked: [] });
  if (user.email) await setDoc(doc(db, 'emails', user.email), { uid: user.uid });
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
      cb({ uid, name: p.name, photo: p.photo, email: p.email, lastActive: ms(p.lastActive), blocked: p.blocked || [] });
    },
    () => cb(null)
  );
}

export async function findUserByEmail(email) {
  const s = await getDoc(doc(db, 'emails', email.trim().toLowerCase()));
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
  // apaga as mensagens em lotes e depois o espaço
  for (;;) {
    const s = await getDocs(query(collection(db, 'conversations', cid, 'messages'), orderBy('at'), limitToLast(300)));
    if (s.empty) break;
    const b = writeBatch(db);
    s.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
    if (s.size < 300) break;
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

export async function sendMessage(cid, uid, text, replyTo) {
  const ref = doc(collection(db, 'conversations', cid, 'messages'));
  const b = writeBatch(db);
  const msg = { text, by: uid, at: serverTimestamp() };
  if (replyTo) msg.replyTo = { id: replyTo.id, by: replyTo.by, text: String(replyTo.text || '').slice(0, 140) };
  b.set(ref, msg);
  b.update(doc(db, 'conversations', cid), {
    lastMessage: { text: text.slice(0, 140), by: uid, at: serverTimestamp() },
    lastMessageAt: serverTimestamp(),
    [`reads.${uid}`]: serverTimestamp(),
    [`typing.${uid}`]: deleteField(),
  });
  await b.commit();
}

export function editMessage(cid, mid, text) {
  return updateDoc(doc(db, 'conversations', cid, 'messages', mid), { text, editedAt: serverTimestamp() });
}

export function deleteMessage(cid, mid) {
  return updateDoc(doc(db, 'conversations', cid, 'messages', mid), { text: '', deleted: true, editedAt: serverTimestamp() });
}

export function toggleReaction(cid, mid, emoji, uid, on) {
  return updateDoc(doc(db, 'conversations', cid, 'messages', mid), { [`reactions.${emoji}`]: on ? arrayUnion(uid) : arrayRemove(uid) });
}

export function report(data) {
  const ref = doc(collection(db, 'reports'));
  return setDoc(ref, { ...data, at: serverTimestamp() });
}
