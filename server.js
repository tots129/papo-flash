// Baamboofree — servidor (Express + Socket.IO). Inicie com: node server.js
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// server/config.js
var require_config = __commonJS({
  "server/config.js"(exports2, module2) {
    "use strict";
    var path2 = require("path");
    try {
      require("dotenv").config({ path: path2.join(process.cwd(), ".env"), quiet: true });
    } catch (_) {
    }
    var isProduction = process.env.NODE_ENV === "production";
    var jwtSecret = process.env.JWT_SECRET || require("crypto").randomBytes(32).toString("hex");
    module2.exports = {
      isProduction,
      port: Number(process.env.PORT) || 3e3,
      host: process.env.HOST || "0.0.0.0",
      jwtSecret,
      sessionDays: 30,
      maxImageBytes: 2 * 1024 * 1024,
      publicDir: process.env.PUBLIC_DIR || path2.join(process.cwd(), "public"),
      corsOrigin: process.env.CORS_ORIGIN || ""
    };
  }
});

// server/store.js
var require_store = __commonJS({
  "server/store.js"(exports2, module2) {
    "use strict";
    var fs2 = require("fs");
    var path2 = require("path");
    var crypto = require("crypto");
    var DATA_DIR = process.env.LOCAL_DATA_DIR || path2.join(process.cwd(), "data");
    var DATABASE_URL = process.env.DATABASE_URL || "";
    var state = { meta: {}, users: {}, games: {}, matches: {} };
    var pool = null;
    var saving = null;
    var dirty = false;
    var retryTimer = null;
    var retryDelay = 5e3;
    function sslOption(url) {
      if (process.env.DATABASE_SSL === "true") return { rejectUnauthorized: false };
      if (process.env.DATABASE_SSL === "false") return false;
      try {
        const host = new URL(url).hostname;
        if (!host.includes(".") || host === "localhost" || host === "127.0.0.1") return false;
        return { rejectUnauthorized: false };
      } catch (_) {
        return false;
      }
    }
    async function init() {
      let loaded = null;
      if (DATABASE_URL) {
        const { Pool } = require("pg");
        pool = new Pool({ connectionString: DATABASE_URL, ssl: sslOption(DATABASE_URL), max: 5 });
        pool.on("error", (err) => console.error("[dados] erro no PostgreSQL:", err.message));
        await pool.query(`CREATE TABLE IF NOT EXISTS jogae_dados (id INTEGER PRIMARY KEY, dados JSONB NOT NULL, atualizado TIMESTAMPTZ DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS jogae_imagens (id TEXT PRIMARY KEY, mime TEXT NOT NULL, dados BYTEA NOT NULL)`);
        await pool.query(`ALTER TABLE jogae_imagens ADD COLUMN IF NOT EXISTS criado TIMESTAMPTZ DEFAULT NOW()`);
        const r = await pool.query("SELECT dados FROM jogae_dados WHERE id = 1");
        loaded = r.rows[0] ? r.rows[0].dados : null;
        console.log("[dados] Salvando no PostgreSQL.");
      } else {
        fs2.mkdirSync(path2.join(DATA_DIR, "imagens"), { recursive: true });
        const file = path2.join(DATA_DIR, "dados.json");
        if (fs2.existsSync(file)) {
          try {
            loaded = JSON.parse(fs2.readFileSync(file, "utf8"));
          } catch (err) {
            console.error("[dados] Arquivo de dados corrompido, come\xE7ando do zero:", err.message);
          }
        }
        console.log(`[dados] Salvando em ${file}`);
      }
      if (loaded) {
        state.meta = loaded.meta || {};
        state.users = loaded.users || {};
        state.games = loaded.games || {};
        state.matches = loaded.matches || {};
      }
      if (!state.meta.secret) {
        state.meta.secret = crypto.randomBytes(32).toString("hex");
        await save();
      }
    }
    async function write() {
      const json = JSON.stringify(state);
      if (pool) {
        await pool.query(
          `INSERT INTO jogae_dados (id, dados, atualizado) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, atualizado = NOW()`,
          [json]
        );
      } else {
        const file = path2.join(DATA_DIR, "dados.json");
        const tmp = `${file}.tmp`;
        await fs2.promises.writeFile(tmp, json);
        await fs2.promises.rename(tmp, file);
      }
    }
    function save() {
      if (saving) {
        dirty = true;
        return saving;
      }
      saving = (async () => {
        do {
          dirty = false;
          try {
            await write();
            retryDelay = 5e3;
          } catch (err) {
            console.error("[dados] erro ao salvar:", err.message);
            if (!retryTimer) {
              retryTimer = setTimeout(() => {
                retryTimer = null;
                save();
              }, retryDelay);
              retryTimer.unref();
              retryDelay = Math.min(retryDelay * 2, 6e4);
            }
          }
        } while (dirty);
      })().finally(() => {
        saving = null;
      });
      return saving;
    }
    var EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
    var MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
    async function saveImage(id, mime, buffer) {
      if (pool) {
        await pool.query("INSERT INTO jogae_imagens (id, mime, dados) VALUES ($1, $2, $3)", [id, mime, buffer]);
      } else {
        await fs2.promises.writeFile(path2.join(DATA_DIR, "imagens", `${id}.${EXT[mime]}`), buffer);
      }
    }
    async function getImage(id) {
      if (pool) {
        const r = await pool.query("SELECT mime, dados FROM jogae_imagens WHERE id = $1", [id]);
        return r.rows[0] ? { mime: r.rows[0].mime, data: Buffer.from(r.rows[0].dados) } : null;
      }
      for (const ext of Object.keys(MIME)) {
        const file = path2.join(DATA_DIR, "imagens", `${id}.${ext}`);
        if (fs2.existsSync(file)) return { mime: MIME[ext], data: await fs2.promises.readFile(file) };
      }
      return null;
    }
    async function deleteImage(id) {
      if (pool) {
        await pool.query("DELETE FROM jogae_imagens WHERE id = $1", [id]);
        return;
      }
      for (const ext of Object.keys(MIME)) {
        await fs2.promises.rm(path2.join(DATA_DIR, "imagens", `${id}.${ext}`), { force: true });
      }
    }
    async function listOldImages(olderThanMs) {
      if (pool) {
        const r = await pool.query(`SELECT id FROM jogae_imagens WHERE criado < NOW() - ($1::int * INTERVAL '1 second')`, [Math.round(olderThanMs / 1e3)]);
        return r.rows.map((x) => x.id);
      }
      const dir = path2.join(DATA_DIR, "imagens");
      const out = [];
      for (const f of await fs2.promises.readdir(dir).catch(() => [])) {
        const st = await fs2.promises.stat(path2.join(dir, f)).catch(() => null);
        if (st && Date.now() - st.mtimeMs > olderThanMs) out.push(f.replace(/\.[a-z]+$/, ""));
      }
      return out;
    }
    async function storageStats() {
      if (pool) {
        const db = await pool.query("SELECT pg_database_size(current_database())::bigint AS bytes");
        const img = await pool.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(octet_length(dados)), 0)::bigint AS bytes FROM jogae_imagens");
        const data = await pool.query("SELECT COALESCE(octet_length(dados::text), 0)::bigint AS bytes FROM jogae_dados WHERE id = 1");
        return {
          kind: "postgres",
          totalBytes: Number(db.rows[0].bytes),
          limitBytes: 512 * 1024 * 1024,
          images: img.rows[0].n,
          imageBytes: Number(img.rows[0].bytes),
          dataBytes: data.rows[0] ? Number(data.rows[0].bytes) : 0
        };
      }
      const dir = path2.join(DATA_DIR, "imagens");
      let images = 0;
      let imageBytes = 0;
      for (const f of await fs2.promises.readdir(dir).catch(() => [])) {
        const st = await fs2.promises.stat(path2.join(dir, f)).catch(() => null);
        if (st) {
          images++;
          imageBytes += st.size;
        }
      }
      const dataBytes = Buffer.byteLength(JSON.stringify(state));
      return { kind: "arquivo", totalBytes: dataBytes + imageBytes, limitBytes: null, images, imageBytes, dataBytes };
    }
    function info() {
      return { kind: pool ? "postgres" : "arquivo", persistent: !!pool };
    }
    async function close() {
      await save();
      if (pool) await pool.end();
      pool = null;
    }
    var now = () => (/* @__PURE__ */ new Date()).toISOString();
    module2.exports = { state, init, save, saveImage, getImage, deleteImage, listOldImages, storageStats, info, close, now };
  }
});

// server/lib/util.js
var require_util = __commonJS({
  "server/lib/util.js"(exports2, module2) {
    "use strict";
    var crypto = require("crypto");
    var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    function randomCode(length = 6, alphabet = CODE_ALPHABET) {
      const bytes = crypto.randomBytes(length);
      let out = "";
      for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
      return out;
    }
    function uuid() {
      return crypto.randomUUID();
    }
    function token() {
      return crypto.randomBytes(24).toString("base64url");
    }
    function normalizeAnswer(text) {
      return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    }
    function cleanText(value, max) {
      return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
    }
    function clampInt(value, min, max, fallback) {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    }
    function shuffle(arr, rng = Math.random) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    function randInt(min, max, rng = Math.random) {
      return min + Math.floor(rng() * (max - min + 1));
    }
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    function isUuid(v) {
      return typeof v === "string" && UUID_RE.test(v);
    }
    var HttpError = class extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
        this.expose = true;
      }
    };
    module2.exports = {
      randomCode,
      uuid,
      token,
      normalizeAnswer,
      cleanText,
      clampInt,
      shuffle,
      randInt,
      isUuid,
      HttpError
    };
  }
});

// shared/constants.js
var require_constants = __commonJS({
  "shared/constants.js"(exports2, module2) {
    "use strict";
    var SUBJECTS = [
      "Geral",
      "Matem\xE1tica",
      "Portugu\xEAs",
      "Ci\xEAncias",
      "Hist\xF3ria",
      "Geografia",
      "Ingl\xEAs",
      "Artes",
      "Educa\xE7\xE3o F\xEDsica",
      "Outros"
    ];
    var CHARACTERS = [
      { id: "tuca", name: "Tuca", kind: "Batata" },
      { id: "bolota", name: "Bolota", kind: "Bolinha" },
      { id: "pingo", name: "Pingo", kind: "Gotinha" },
      { id: "zeze", name: "Zez\xE9", kind: "Cubinho" },
      { id: "nino", name: "Nino", kind: "Ovinho" },
      { id: "lulu", name: "Lulu", kind: "Cogumelo" },
      { id: "rex", name: "Rex", kind: "Dino" },
      { id: "fafa", name: "Faf\xE1", kind: "Nuvem" }
    ];
    var COLORS = [
      "#FFB627",
      // milho
      "#FF5D8F",
      // chiclete
      "#3DDC97",
      // menta
      "#4CC9F0",
      // céu
      "#9B5DE5",
      // uva
      "#FF7B39",
      // laranja
      "#F15BB5",
      // pitaya
      "#00BBF9",
      // piscina
      "#C5E063",
      // limão
      "#E63946"
      // tomate
    ];
    var SPUD_EVENTS = {
      advance: { label: "Avan\xE7ar casas", icon: "\u{1F680}", description: "Avan\xE7a de 2 a 4 casas.", negative: false },
      back: { label: "Voltar casas", icon: "\u{1F300}", description: "Volta de 2 a 3 casas.", negative: true },
      swap: { label: "Troca-troca", icon: "\u{1F504}", description: "Troca de lugar com outro participante.", negative: false },
      skip: { label: "Perder a vez", icon: "\u{1F634}", description: "Fica uma rodada sem jogar.", negative: true },
      points: { label: "Pontos extras", icon: "\u{1F48E}", description: "Ganha 20 pontos extras.", negative: false },
      shuffle: { label: "Embaralhar", icon: "\u{1F32A}\uFE0F", description: "Embaralha as posi\xE7\xF5es de todos.", negative: false }
    };
    var POWERUPS = {
      speed: { label: "Speed Boost", icon: "\u26A1", description: "Na pr\xF3xima resposta certa, anda 3 casas extras." },
      shield: { label: "Shield", icon: "\u{1F6E1}\uFE0F", description: "Protege contra o pr\xF3ximo evento negativo." },
      double: { label: "Double Points", icon: "\u2716\uFE0F2", description: "Dobra os pontos da pr\xF3xima resposta certa." },
      swap: { label: "Swap", icon: "\u{1F501}", description: "Troca de posi\xE7\xE3o com quem voc\xEA escolher." },
      shuffle: { label: "Shuffle Players", icon: "\u{1F3B2}", description: "Embaralha as posi\xE7\xF5es de todos agora." },
      break: { label: "Quebrar casas", icon: "\u{1F528}", description: "Quebra 2 casas na raia de algu\xE9m: quem chegar nelas para ali." },
      reverse: { label: "Inverter a roda", icon: "\u{1F503}", description: "Na pr\xF3xima roda da morte, quem for pego avan\xE7a 5 casas em vez de voltar." },
      target: { label: "Escolher o alvo", icon: "\u{1F3AF}", description: "Voc\xEA escolhe quem a roda da morte vai pegar no fim da rodada." },
      leap: { label: "Passar na frente", icon: "\u{1F3C3}", description: "Pula para a casa logo \xE0 frente de quem est\xE1 em 1\xBA lugar." },
      paint: { label: "Pintar casa", icon: "\u{1F58C}\uFE0F", description: "Pinta de verde a pr\xF3xima casa vermelha da sua raia: ela fica segura." }
    };
    var LIMITS = {
      titleMax: 120,
      descriptionMax: 600,
      questionTextMax: 400,
      optionTextMax: 160,
      optionsMin: 2,
      optionsMax: 6,
      acceptedAnswersMax: 8,
      questionsMax: 300,
      playerNameMax: 20,
      teamNameMax: 24,
      playersPerRoomMax: 60,
      teamsMin: 2,
      teamsMax: 6
    };
    var HACKER_PASSWORDS = ["PIZZA", "FOGUETE", "DRAG\xC3O", "BANANA", "TROV\xC3O", "PANDA", "GAL\xC1XIA", "PIRATA", "NINJA", "CHICLETE", "VULC\xC3O", "ROB\xD4"];
    module2.exports = { SUBJECTS, CHARACTERS, COLORS, SPUD_EVENTS, POWERUPS, LIMITS, HACKER_PASSWORDS };
  }
});

// server/lib/validate.js
var require_validate = __commonJS({
  "server/lib/validate.js"(exports2, module2) {
    "use strict";
    var { SUBJECTS, LIMITS, CHARACTERS, COLORS } = require_constants();
    var { cleanText, clampInt, isUuid, uuid, HttpError } = require_util();
    var SHORT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
    function safeId(v) {
      return typeof v === "string" && SHORT_ID_RE.test(v) ? v : uuid().slice(0, 8);
    }
    function sanitizeQuestion(input, defaults) {
      const q = input && typeof input === "object" ? input : {};
      const type = q.type === "open" ? "open" : "multiple";
      const out = {
        id: safeId(q.id),
        type,
        text: cleanText(q.text, LIMITS.questionTextMax),
        image: isUuid(q.image) ? q.image : null,
        points: clampInt(q.points, 0, 1e3, defaults.points),
        time: q.time === null || q.time === "" || q.time === void 0 ? null : clampInt(q.time, 5, 300, null),
        options: [],
        correct: null,
        answers: []
      };
      if (type === "multiple") {
        const opts = Array.isArray(q.options) ? q.options.slice(0, LIMITS.optionsMax) : [];
        const seen = /* @__PURE__ */ new Set();
        for (const o of opts) {
          if (!o || typeof o !== "object") continue;
          let id = safeId(o.id);
          while (seen.has(id)) id = uuid().slice(0, 8);
          seen.add(id);
          out.options.push({ id, text: cleanText(o.text, LIMITS.optionTextMax) });
        }
        out.correct = out.options.some((o) => o.id === q.correct) ? q.correct : null;
      } else {
        const answers = Array.isArray(q.answers) ? q.answers : [];
        out.answers = answers.map((a) => cleanText(a, LIMITS.optionTextMax)).filter(Boolean).slice(0, LIMITS.acceptedAnswersMax);
      }
      return out;
    }
    function isQuestionReady(q) {
      if (!q.text && !q.image) return false;
      if (q.type === "multiple") {
        const filled = q.options.filter((o) => o.text);
        return filled.length >= LIMITS.optionsMin && !!q.correct && filled.some((o) => o.id === q.correct);
      }
      return q.answers.length > 0;
    }
    function sanitizeSettings(input) {
      const s = input && typeof input === "object" ? input : {};
      return {
        defaultTime: clampInt(s.defaultTime, 0, 300, 20),
        defaultPoints: clampInt(s.defaultPoints, 0, 1e3, 10)
      };
    }
    function sanitizeGame(input, { partial = false } = {}) {
      const g = input && typeof input === "object" ? input : {};
      const out = {};
      if (!partial || "title" in g) {
        out.title = cleanText(g.title, LIMITS.titleMax) || "Jogo sem t\xEDtulo";
      }
      if (!partial || "description" in g) out.description = cleanText(g.description, LIMITS.descriptionMax);
      if (!partial || "subject" in g) out.subject = SUBJECTS.includes(g.subject) ? g.subject : "Geral";
      if (!partial || "cover_image" in g || "coverImage" in g) {
        const c = g.cover_image !== void 0 ? g.cover_image : g.coverImage;
        out.cover_image = isUuid(c) ? c : null;
      }
      if (!partial || "settings" in g) out.settings = sanitizeSettings(g.settings);
      if (!partial || "questions" in g) {
        if (g.questions !== void 0 && !Array.isArray(g.questions)) {
          throw new HttpError(400, "O campo de perguntas \xE9 inv\xE1lido.");
        }
        const list = Array.isArray(g.questions) ? g.questions : [];
        if (list.length > LIMITS.questionsMax) {
          throw new HttpError(400, `Um jogo pode ter no m\xE1ximo ${LIMITS.questionsMax} perguntas.`);
        }
        const defaults = { points: out.settings && out.settings.defaultPoints || 10 };
        const ids = /* @__PURE__ */ new Set();
        out.questions = list.map((q) => {
          const clean = sanitizeQuestion(q, defaults);
          while (ids.has(clean.id)) clean.id = uuid().slice(0, 8);
          ids.add(clean.id);
          return clean;
        });
      }
      if ("is_shared" in g || "isShared" in g) {
        out.is_shared = Boolean(g.is_shared !== void 0 ? g.is_shared : g.isShared);
      }
      return out;
    }
    function sanitizeAvatar(input) {
      const a = input && typeof input === "object" ? input : {};
      return {
        character: CHARACTERS.some((c) => c.id === a.character) ? a.character : CHARACTERS[0].id,
        color: COLORS.includes(a.color) ? a.color : COLORS[0]
      };
    }
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    function validateEmail(email) {
      const e = cleanText(email, 200).toLowerCase();
      if (!EMAIL_RE.test(e)) throw new HttpError(400, "Digite um e-mail v\xE1lido.");
      return e;
    }
    function validatePassword(pw) {
      if (typeof pw !== "string" || pw.length < 6) throw new HttpError(400, "A senha precisa ter pelo menos 6 caracteres.");
      if (pw.length > 200) throw new HttpError(400, "A senha \xE9 longa demais.");
      return pw;
    }
    function validateName(name) {
      const n = cleanText(name, 60);
      if (n.length < 2) throw new HttpError(400, "Digite um nome com pelo menos 2 letras.");
      return n;
    }
    module2.exports = {
      sanitizeGame,
      sanitizeQuestion,
      sanitizeSettings,
      isQuestionReady,
      sanitizeAvatar,
      validateEmail,
      validatePassword,
      validateName
    };
  }
});

// server/middleware/auth.js
var require_auth = __commonJS({
  "server/middleware/auth.js"(exports2, module2) {
    "use strict";
    var jwt = require("jsonwebtoken");
    var config2 = require_config();
    var store2 = require_store();
    var COOKIE = "jogae_sessao";
    function secret() {
      return process.env.JWT_SECRET || store2.state.meta.secret || config2.jwtSecret;
    }
    function signSession(userId) {
      return jwt.sign({ sub: userId }, secret(), { expiresIn: `${config2.sessionDays}d` });
    }
    var TOKEN_HEADER = "X-Session-Token";
    function setSessionCookie(req, res, userId) {
      const token = signSession(userId);
      res.set(TOKEN_HEADER, token);
      res.cookie(COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: req.secure,
        maxAge: config2.sessionDays * 24 * 60 * 60 * 1e3,
        path: "/"
      });
    }
    function clearSessionCookie(res) {
      res.set(TOKEN_HEADER, "-");
      res.clearCookie(COOKIE, { path: "/" });
    }
    function verifyPayload(raw) {
      if (!raw) return null;
      try {
        const payload = jwt.verify(raw, secret());
        return typeof payload.sub === "string" ? payload : null;
      } catch (_) {
        return null;
      }
    }
    function verifyToken(raw) {
      const p = verifyPayload(raw);
      return p ? p.sub : null;
    }
    function userIdFromCookieHeader(header) {
      if (!header) return null;
      for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx < 0) continue;
        if (part.slice(0, idx).trim() === COOKIE) {
          return verifyToken(decodeURIComponent(part.slice(idx + 1).trim()));
        }
      }
      return null;
    }
    function isAdminEmail(email) {
      const list = String(process.env.ADMIN_EMAIL || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
      return !!email && list.includes(String(email).toLowerCase());
    }
    function publicUser(row) {
      if (!row) return null;
      const u = { id: row.id, name: row.name, email: row.email, avatar: row.avatar, createdAt: row.created_at };
      if (row.is_guest) u.isGuest = true;
      else if (isAdminEmail(row.email)) u.isAdmin = true;
      return u;
    }
    function requireAdmin(req, _res, next) {
      if (!req.user) return _res.status(401).json({ error: "Entre na sua conta para continuar." });
      if (!req.user.isAdmin) return _res.status(403).json({ error: "Esta p\xE1gina \xE9 s\xF3 para o dono do site." });
      next();
    }
    function bearer(req) {
      const h = req.get("authorization") || "";
      return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
    }
    function loadUser2(req, res, next) {
      const payload = verifyPayload(req.cookies && req.cookies[COOKIE]) || verifyPayload(bearer(req));
      req.user = payload ? publicUser(store2.state.users[payload.sub]) : null;
      if (req.user) {
        const row = store2.state.users[req.user.id];
        const nowIso = store2.now();
        if (row && (!row.last_seen_at || Date.parse(nowIso) - Date.parse(row.last_seen_at) > 60 * 60 * 1e3)) {
          row.last_seen_at = nowIso;
          store2.save();
        }
      }
      if (req.user && payload.iat && Date.now() / 1e3 - payload.iat > 24 * 60 * 60) {
        setSessionCookie(req, res, req.user.id);
      }
      next();
    }
    function requireAuth(req, res, next) {
      if (!req.user) return res.status(401).json({ error: "Entre na sua conta para continuar." });
      next();
    }
    module2.exports = {
      COOKIE,
      setSessionCookie,
      clearSessionCookie,
      userIdFromCookieHeader,
      verifyToken,
      requireAdmin,
      publicUser,
      loadUser: loadUser2,
      requireAuth
    };
  }
});

// server/routes/games.js
var require_games = __commonJS({
  "server/routes/games.js"(exports2, module2) {
    "use strict";
    var express2 = require("express");
    var store2 = require_store();
    var { uuid, randomCode, isUuid, HttpError, cleanText, normalizeAnswer } = require_util();
    var { sanitizeGame, isQuestionReady } = require_validate();
    var { requireAuth } = require_auth();
    var { SUBJECTS } = require_constants();
    var router = express2.Router();
    function summary(row) {
      const questions = Array.isArray(row.questions) ? row.questions : [];
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        subject: row.subject,
        coverImage: row.cover_image,
        questionCount: questions.length,
        readyCount: questions.filter(isQuestionReady).length,
        isShared: row.is_shared,
        isPublic: !!row.is_public,
        copies: row.copies || 0,
        shareCode: row.share_code,
        plays: row.plays,
        lastPlayedAt: row.last_played_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
    function full(row) {
      const questions = Array.isArray(row.questions) ? row.questions : [];
      return {
        ...summary(row),
        settings: row.settings || {},
        questions: questions.map((q) => ({ ...q, ready: isQuestionReady(q) }))
      };
    }
    function uniqueShareCode() {
      const taken = new Set(Object.values(store2.state.games).map((g) => g.share_code));
      let code;
      do
        code = randomCode(8);
      while (taken.has(code));
      return code;
    }
    function insertGame(ownerId, data, extra = {}) {
      const clean = sanitizeGame(data);
      const t = store2.now();
      const row = {
        id: uuid(),
        owner_id: ownerId,
        title: clean.title,
        description: clean.description,
        subject: clean.subject,
        cover_image: clean.cover_image,
        questions: clean.questions,
        settings: clean.settings,
        share_code: uniqueShareCode(),
        is_shared: false,
        is_demo: false,
        plays: 0,
        last_played_at: null,
        created_at: t,
        updated_at: t,
        ...extra
      };
      store2.state.games[row.id] = row;
      return row;
    }
    function ownedGame(req) {
      const row = isUuid(req.params.id) ? store2.state.games[req.params.id] : null;
      if (!row || row.owner_id !== req.user.id) throw new HttpError(404, "Jogo n\xE3o encontrado.");
      return row;
    }
    function copyFields(src) {
      return {
        title: src.title,
        description: src.description,
        subject: src.subject,
        cover_image: src.cover_image,
        questions: src.questions,
        settings: src.settings
      };
    }
    router.get("/games", requireAuth, (req, res) => {
      const mine = Object.values(store2.state.games).filter((g) => g.owner_id === req.user.id);
      const search = normalizeAnswer(cleanText(req.query.search, 100));
      const subject = SUBJECTS.includes(req.query.subject) ? req.query.subject : null;
      const games = mine.filter((g) => (!search || normalizeAnswer(g.title).includes(search)) && (!subject || g.subject === subject)).sort((a, b) => a.updated_at < b.updated_at ? 1 : -1);
      const lastTouch = (g) => g.last_played_at && g.last_played_at > g.updated_at ? g.last_played_at : g.updated_at;
      const recent = mine.slice().sort((a, b) => lastTouch(a) < lastTouch(b) ? 1 : -1).slice(0, 4);
      res.json({ games: games.map(summary), recent: recent.map(summary) });
    });
    router.post("/games", requireAuth, async (req, res) => {
      const row = insertGame(req.user.id, req.body || {});
      await store2.save();
      res.status(201).json({ game: full(row) });
    });
    router.get("/games/:id", requireAuth, (req, res) => {
      res.json({ game: full(ownedGame(req)) });
    });
    router.put("/games/:id", requireAuth, async (req, res) => {
      const row = ownedGame(req);
      const clean = sanitizeGame(req.body || {}, { partial: true });
      if (!Object.keys(clean).length) throw new HttpError(400, "Nada para salvar.");
      Object.assign(row, clean, { updated_at: store2.now() });
      await store2.save();
      res.json({ game: full(row) });
    });
    router.delete("/games/:id", requireAuth, async (req, res) => {
      const row = ownedGame(req);
      delete store2.state.games[row.id];
      await store2.save();
      res.json({ ok: true });
    });
    router.post("/games/:id/duplicate", requireAuth, async (req, res) => {
      const src = ownedGame(req);
      const row = insertGame(req.user.id, { ...copyFields(src), title: `${src.title} (c\xF3pia)`.slice(0, 120) });
      await store2.save();
      res.status(201).json({ game: full(row) });
    });
    router.post("/games/:id/share", requireAuth, async (req, res) => {
      const row = ownedGame(req);
      row.is_shared = !(req.body && req.body.shared === false);
      row.updated_at = store2.now();
      await store2.save();
      res.json({ game: summary(row) });
    });
    function sharedGame(code) {
      const c = String(code || "").toUpperCase();
      const row = /^[A-Z0-9]{8}$/.test(c) ? Object.values(store2.state.games).find((g) => g.share_code === c) : null;
      if (!row) throw new HttpError(404, "Este link de jogo n\xE3o existe.");
      if (!row.is_shared) throw new HttpError(404, "Este jogo n\xE3o est\xE1 mais compartilhado.");
      return row;
    }
    router.get("/shared/:code", (req, res) => {
      const row = sharedGame(req.params.code);
      const owner = store2.state.users[row.owner_id];
      const game = full(row);
      delete game.isShared;
      res.json({ game: { ...game, ownerName: owner ? owner.name : "Equipe Baamboofree", isMine: !!req.user && req.user.id === row.owner_id } });
    });
    router.post("/shared/:code/copy", requireAuth, async (req, res) => {
      const src = sharedGame(req.params.code);
      const row = insertGame(req.user.id, copyFields(src));
      await store2.save();
      res.status(201).json({ game: full(row) });
    });
    module2.exports = router;
    module2.exports.insertGame = insertGame;
    module2.exports.copyFields = copyFields;
  }
});

// server/seed.js
var require_seed = __commonJS({
  "server/seed.js"(exports2, module2) {
    "use strict";
    var store2 = require_store();
    var { uuid } = require_util();
    var SYSTEM_EMAIL = "demonstracao@jogae.sistema";
    var n = 0;
    function mc(text, options, correctIndex, extra = {}) {
      const opts = options.map((t, i) => ({ id: `o${++n}${i}`, text: t }));
      return { id: `q${++n}`, type: "multiple", text, options: opts, correct: opts[correctIndex].id, ...extra };
    }
    function open(text, answers, extra = {}) {
      return { id: `q${++n}`, type: "open", text, answers, ...extra };
    }
    var DEMOS = [
      {
        title: "Tabuada Turbo",
        subject: "Matem\xE1tica",
        description: "Contas r\xE1pidas, fra\xE7\xF5es e geometria b\xE1sica para aquecer a turma.",
        questions: [
          mc("Quanto \xE9 7 \xD7 8?", ["54", "56", "63", "48"], 1),
          mc("Quanto \xE9 9 \xD7 6?", ["54", "45", "56", "64"], 0),
          open("Quanto \xE9 144 \xF7 12?", ["12", "doze"]),
          mc("Qual \xE9 a metade de 250?", ["115", "120", "125", "150"], 2),
          open("Quanto \xE9 15 + 27?", ["42", "quarenta e dois"]),
          mc("Quantos lados tem um hex\xE1gono?", ["5", "6", "7", "8"], 1),
          mc("Quanto \xE9 3\xB2?", ["6", "9", "12", "27"], 1),
          mc("Qual destes n\xFAmeros \xE9 primo?", ["21", "27", "29", "33"], 2),
          mc("Quanto \xE9 25% de 80?", ["20", "25", "30", "40"], 0, { points: 15 }),
          mc("Quanto \xE9 1000 \u2212 375?", ["525", "625", "675", "735"], 1),
          open("Quantos minutos h\xE1 em 2 horas?", ["120", "cento e vinte"]),
          mc("Qual fra\xE7\xE3o \xE9 igual a 0,5?", ["1/4", "1/3", "1/2", "2/3"], 2)
        ]
      },
      {
        title: "Capitais do Brasil",
        subject: "Geografia",
        description: "Do Norte ao Sul: ser\xE1 que a turma conhece todas as capitais?",
        questions: [
          mc("Qual \xE9 a capital de Goi\xE1s?", ["An\xE1polis", "Goi\xE2nia", "Rio Verde", "Catal\xE3o"], 1),
          mc("Qual \xE9 a capital do Brasil?", ["Rio de Janeiro", "S\xE3o Paulo", "Bras\xEDlia", "Salvador"], 2),
          mc("Qual \xE9 a capital da Bahia?", ["Salvador", "Feira de Santana", "Ilh\xE9us", "Recife"], 0),
          mc("Qual \xE9 a capital do Amazonas?", ["Bel\xE9m", "Manaus", "Porto Velho", "Boa Vista"], 1),
          mc("Qual \xE9 a capital do Paran\xE1?", ["Londrina", "Florian\xF3polis", "Curitiba", "Maring\xE1"], 2),
          open("Qual \xE9 a capital de Pernambuco?", ["Recife"]),
          mc("Qual \xE9 a capital do Rio Grande do Sul?", ["Porto Alegre", "Pelotas", "Caxias do Sul", "Gramado"], 0),
          mc("Qual \xE9 a capital do Par\xE1?", ["Macap\xE1", "Santar\xE9m", "Bel\xE9m", "S\xE3o Lu\xEDs"], 2),
          mc("Qual \xE9 a capital do Cear\xE1?", ["Natal", "Fortaleza", "Teresina", "Jo\xE3o Pessoa"], 1),
          open("Qual \xE9 a capital de Minas Gerais?", ["Belo Horizonte", "BH"]),
          mc("Palmas \xE9 a capital de qual estado?", ["Tocantins", "Mato Grosso", "Maranh\xE3o", "Piau\xED"], 0, { points: 15 }),
          mc("Qual \xE9 a capital de Santa Catarina?", ["Joinville", "Blumenau", "Florian\xF3polis", "Chapec\xF3"], 2)
        ]
      },
      {
        title: "Planeta e Corpo Humano",
        subject: "Ci\xEAncias",
        description: "Sistema Solar, corpo humano e natureza em perguntas r\xE1pidas.",
        questions: [
          mc("Qual planeta fica mais perto do Sol?", ["V\xEAnus", "Terra", "Merc\xFArio", "Marte"], 2),
          mc("Qual \xE9 o maior planeta do Sistema Solar?", ["Saturno", "J\xFApiter", "Netuno", "Terra"], 1),
          open("Qual \xF3rg\xE3o bombeia o sangue pelo corpo?", ["cora\xE7\xE3o", "o cora\xE7\xE3o"]),
          mc("Quantos ossos tem o corpo de um adulto?", ["106", "186", "206", "306"], 2, { points: 15 }),
          mc("Que g\xE1s as plantas absorvem na fotoss\xEDntese?", ["Oxig\xEAnio", "G\xE1s carb\xF4nico", "H\xE9lio", "Nitrog\xEAnio"], 1),
          mc("Em que estado f\xEDsico a \xE1gua est\xE1 no gelo?", ["S\xF3lido", "L\xEDquido", "Gasoso", "Plasma"], 0),
          open("Qual \xE9 o maior \xF3rg\xE3o do corpo humano?", ["pele", "a pele"]),
          mc("Qual destes mam\xEDferos consegue voar?", ["Pinguim", "Morcego", "Avestruz", "Galinha"], 1),
          open("Qual \xE9 a f\xF3rmula qu\xEDmica da \xE1gua?", ["H2O", "H\u2082O"]),
          mc("Quantas patas tem um inseto?", ["4", "6", "8", "10"], 1),
          mc("Qual \xE9 o sat\xE9lite natural da Terra?", ["Sol", "Marte", "Lua", "Estrela-d\u2019alva"], 2)
        ]
      },
      {
        title: "English Fun",
        subject: "Ingl\xEAs",
        description: "Vocabul\xE1rio do dia a dia em ingl\xEAs: cores, n\xFAmeros, dias e sauda\xE7\xF5es.",
        questions: [
          mc("O que significa \u201Ccat\u201D?", ["Cachorro", "Gato", "Rato", "Pato"], 1),
          mc("Como se diz \u201Cvermelho\u201D em ingl\xEAs?", ["Blue", "Green", "Red", "Yellow"], 2),
          mc("\u201CMonday\u201D \xE9 qual dia da semana?", ["Domingo", "Segunda-feira", "Sexta-feira", "S\xE1bado"], 1),
          open("Como se diz \u201Cobrigado\u201D em ingl\xEAs?", ["thank you", "thanks"]),
          mc("O que significa \u201Cbook\u201D?", ["Livro", "Caderno", "Bolsa", "Mesa"], 0),
          open("Como se escreve o n\xFAmero 12 em ingl\xEAs?", ["twelve"]),
          mc("O que significa \u201Capple\u201D?", ["Banana", "Uva", "Ma\xE7\xE3", "Laranja"], 2),
          mc("Qual \xE9 o plural de \u201Cdog\u201D?", ["Doges", "Dogs", "Dogies", "Dog"], 1),
          mc("Qual \xE9 o oposto de \u201Cbig\u201D?", ["Tall", "Long", "Small", "Fast"], 2),
          mc("O que significa \u201Cgood morning\u201D?", ["Boa noite", "Boa tarde", "Bom dia", "At\xE9 logo"], 2)
        ]
      }
    ];
    function systemUserId() {
      const existing = Object.values(store2.state.users).find((u) => u.email === SYSTEM_EMAIL);
      if (existing) return existing.id;
      const id = uuid();
      store2.state.users[id] = { id, name: "Equipe Baamboofree", email: SYSTEM_EMAIL, password_hash: "!", avatar: {}, created_at: store2.now() };
      return id;
    }
    async function seedDemos2() {
      if (Object.values(store2.state.games).some((g) => g.is_demo)) return;
      const { insertGame } = require_games();
      const owner = systemUserId();
      for (const demo of DEMOS) insertGame(owner, demo, { is_demo: true, is_shared: true });
      await store2.save();
      console.log(`[dados] ${DEMOS.length} jogos de demonstra\xE7\xE3o criados.`);
    }
    function copyDemoGamesTo(userId) {
      const { insertGame, copyFields } = require_games();
      const demos = Object.values(store2.state.games).filter((g) => g.is_demo).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
      for (const d of demos) insertGame(userId, copyFields(d), { from_demo: true });
    }
    module2.exports = { seedDemos: seedDemos2, copyDemoGamesTo, systemUserId, SYSTEM_EMAIL };
  }
});

// server/game/board.js
var require_board = __commonJS({
  "server/game/board.js"(exports2, module2) {
    "use strict";
    function generateBoard(length, { eventsEnabled, powerupsEnabled, rng = Math.random }) {
      const L = Math.max(12, Math.min(60, length));
      const tiles = Array.from({ length: L }, () => "normal");
      tiles[0] = "start";
      tiles[L - 1] = "finish";
      const candidates = [];
      for (let i = 2; i <= L - 3; i++) candidates.push(i);
      const want = {
        power: powerupsEnabled ? Math.round(L * 0.15) : 0,
        danger: Math.round(L * 0.14),
        event: eventsEnabled ? Math.round(L * 0.1) : 0
      };
      const order = candidates.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const sequence = [];
      const kinds = ["danger", "power", "event"];
      let k = 0;
      while (sequence.length < want.power + want.danger + want.event) {
        const kind = kinds[k % 3];
        k++;
        if (sequence.filter((s) => s === kind).length < want[kind]) sequence.push(kind);
        if (k > 1e3) break;
      }
      for (const kind of sequence) {
        const idx = order.findIndex((pos) => {
          if (tiles[pos] !== "normal") return false;
          return tiles[pos - 1] === "normal" || tiles[pos - 1] === "start" ? tiles[pos + 1] === "normal" || tiles[pos + 1] === "finish" : false;
        });
        if (idx === -1) break;
        tiles[order[idx]] = kind;
        order.splice(idx, 1);
      }
      return tiles;
    }
    module2.exports = { generateBoard };
  }
});

// shared/medals.js
var require_medals = __commonJS({
  "shared/medals.js"(exports2, module2) {
    "use strict";
    var MEDALS = {
      champion: { icon: "\u{1F3C6}", name: "Campe\xE3o", desc: "Ficou em 1\xBA lugar" },
      podium: { icon: "\u{1F948}", name: "No p\xF3dio", desc: "Ficou entre os 3 primeiros" },
      perfect: { icon: "\u{1F3AF}", name: "Gabaritou", desc: "Acertou todas as perguntas" },
      unstoppable: { icon: "\u{1F525}", name: "Impar\xE1vel", desc: "Acertou 5 seguidas" },
      streak: { icon: "\u2728", name: "Em sequ\xEAncia", desc: "Acertou 3 seguidas" },
      lightning: { icon: "\u26A1", name: "Rel\xE2mpago", desc: "Respondeu certo mais r\xE1pido" },
      record: { icon: "\u{1F31F}", name: "Novo recorde", desc: "Bateu o seu melhor resultado" },
      brave: { icon: "\u{1F4AA}", name: "N\xE3o desistiu", desc: "Respondeu todas as perguntas" }
    };
    function computeMedals(list, { solo = false } = {}) {
      const out = {};
      const many = list.length >= 2;
      const avg = (r) => r.fastN ? r.fastMs / r.fastN : Infinity;
      let fastest = null;
      if (many) {
        const maxAsked = Math.max(...list.map((r) => r.asked || 0));
        const minRight = Math.max(2, Math.ceil(maxAsked / 3));
        const ok = list.filter((r) => r.fastN >= minRight).sort((a, b) => avg(a) - avg(b));
        if (ok.length && (ok.length === 1 || avg(ok[0]) < avg(ok[1]))) fastest = ok[0].id;
      }
      for (const r of list) {
        const m = [];
        if (!solo && many && r.place === 1 && r.correct > 0) m.push("champion");
        if (r.asked >= 3 && r.correct === r.asked) m.push("perfect");
        if (r.bestStreak >= 5) m.push("unstoppable");
        else if (r.bestStreak >= 3) m.push("streak");
        if (r.id === fastest || solo && r.fastN >= 3 && avg(r) <= 4e3) m.push("lightning");
        if (!solo && list.length >= 4 && (r.place === 2 || r.place === 3)) m.push("podium");
        if (!m.length && r.asked >= 3 && r.replied >= r.asked) m.push("brave");
        out[r.id] = m.slice(0, 3);
      }
      return out;
    }
    module2.exports = { MEDALS, computeMedals };
  }
});

// server/game/hacker.js
var require_hacker = __commonJS({
  "server/game/hacker.js"(exports2, module2) {
    "use strict";
    var { HACKER_PASSWORDS } = require_constants();
    var { shuffle } = require_util();
    var WRONG_LOCK_MS = 2500;
    var STEAL_SHARE = 0.25;
    var FEED_MAX = 12;
    var NOTICE_MS = 6e3;
    var REWARDS = [
      { kind: "coins", amount: 10, weight: 12 },
      { kind: "coins", amount: 20, weight: 14 },
      { kind: "coins", amount: 30, weight: 12 },
      { kind: "coins", amount: 50, weight: 10 },
      { kind: "coins", amount: 75, weight: 6 },
      { kind: "coins", amount: 100, weight: 4 },
      { kind: "double", weight: 5 },
      { kind: "hack", weight: 16 },
      { kind: "nothing", weight: 4 }
    ];
    var TOTAL_WEIGHT = REWARDS.reduce((n, r) => n + r.weight, 0);
    var HackerError = class extends Error {
    };
    function rollReward(rng) {
      let x = rng() * TOTAL_WEIGHT;
      for (const r of REWARDS) {
        x -= r.weight;
        if (x < 0) return { ...r };
      }
      return { ...REWARDS[0] };
    }
    function rewardLabel(r) {
      if (r.kind === "coins") return `+${r.amount}`;
      if (r.kind === "double") return "\xD72";
      if (r.kind === "hack") return "Hackear";
      return "Nada";
    }
    var hackerMethods = {
      /** Senha escolhida na sala de espera. */
      setHackerPassword(playerId, password) {
        const p = this.players.get(playerId);
        if (!p || p.kicked) throw new HackerError("Participante n\xE3o encontrado.");
        if (this.config.mode !== "hacker") throw new HackerError("Esta partida n\xE3o \xE9 do Modo Hacker.");
        if (!HACKER_PASSWORDS.includes(password)) throw new HackerError("Escolha uma das senhas da lista.");
        p.password = password;
        const st = this.state.get(this.competitorIdOf(p));
        if (st && st.h) st.h.password = password;
        this.changed();
      },
      hackerStart() {
        this.phase = "playing";
        this.hacker = { endsAt: Date.now() + this.config.hackerMinutes * 60 * 1e3, feed: [], seq: 0 };
        for (const id of this.turnOrder) this.hackerInit(id);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          try {
            this.finish(null);
          } catch (err) {
            console.error("[sala] erro ao terminar o Modo Hacker:", err);
          }
        }, this.config.hackerMinutes * 60 * 1e3);
        this.changed();
      },
      hackerInit(id) {
        const st = this.state.get(id);
        if (!st || st.h) return;
        const p = this.players.get(id);
        const used = new Set([...this.players.values()].map((x) => x.password).filter(Boolean));
        const free = HACKER_PASSWORDS.filter((w) => !used.has(w));
        const pool = free.length ? free : HACKER_PASSWORDS;
        st.h = {
          password: p && p.password || pool[Math.floor(this.rng() * pool.length)],
          deck: [],
          pos: 0,
          q: null,
          qStarted: 0,
          stage: "question",
          lockedUntil: 0,
          last: null,
          // resultado da última resposta
          boxes: null,
          picked: null,
          targetId: null,
          guess: null,
          result: null,
          // mensagem do que aconteceu na caixa/hack
          notices: []
          // "você foi hackeado"
        };
        if (p && !p.password) p.password = st.h.password;
        this.hackerNextQuestion(st.h);
      },
      hackerNextQuestion(h) {
        if (h.pos >= h.deck.length) {
          const last = h.deck[h.pos - 1];
          const idx = this.questions.map((_, i) => i);
          h.deck = this.config.shuffleQuestions ? shuffle(idx, this.rng) : idx;
          if (h.deck.length > 1 && h.deck[0] === last) h.deck.push(h.deck.shift());
          h.pos = 0;
        }
        h.q = h.deck[h.pos++];
        h.qStarted = Date.now();
        h.stage = "question";
        h.boxes = null;
        h.picked = null;
        h.targetId = null;
        h.guess = null;
        h.result = null;
      },
      hackerFeed(entry) {
        this.hacker.seq++;
        this.hacker.feed.unshift({ id: this.hacker.seq, at: Date.now(), ...entry });
        this.hacker.feed.length = Math.min(this.hacker.feed.length, FEED_MAX);
      },
      /** Ações do participante no Modo Hacker. */
      hackerAction(playerId, { action, value }) {
        if (this.phase !== "playing" || !this.hacker) throw new HackerError("A partida n\xE3o est\xE1 acontecendo agora.");
        const p = this.players.get(playerId);
        if (!p || p.kicked) throw new HackerError("Participante n\xE3o encontrado.");
        const id = this.competitorIdOf(p);
        const st = this.state.get(id);
        if (!st || !st.h) throw new HackerError("Participante n\xE3o encontrado.");
        const h = st.h;
        const name = p.name;
        if (action === "answer") {
          if (h.stage !== "question") throw new HackerError("Responda a pergunta da tela.");
          const q = this.questions[h.q];
          const res = this.checkAnswer(q, String(value || ""));
          st.answered++;
          st.replied++;
          if (res.correct) {
            st.correct++;
            st.streak++;
            st.bestStreak = Math.max(st.bestStreak, st.streak);
            st.fastMs += Math.min(6e4, Date.now() - h.qStarted);
            st.fastN++;
            h.stage = "boxes";
            h.boxes = [rollReward(this.rng), rollReward(this.rng), rollReward(this.rng)];
            h.last = { correct: true };
          } else {
            st.streak = 0;
            h.stage = "wrong";
            h.lockedUntil = Date.now() + WRONG_LOCK_MS;
            const right = q.type === "multiple" ? (q.options.find((o) => o.id === q.correct) || {}).text : q.answers[0];
            h.last = { correct: false, rightAnswer: right || "", yourAnswer: res.text };
          }
        } else if (action === "next") {
          if (h.stage === "wrong") {
            if (Date.now() < h.lockedUntil - 300) throw new HackerError("Espere um pouquinho...");
          } else if (h.stage !== "result") throw new HackerError("Agora n\xE3o d\xE1 para pular.");
          this.hackerNextQuestion(h);
        } else if (action === "pick") {
          if (h.stage !== "boxes") throw new HackerError("N\xE3o h\xE1 caixas para abrir agora.");
          const i = Number(value);
          if (!Number.isInteger(i) || i < 0 || i > 2) throw new HackerError("Escolha uma das caixas.");
          h.picked = i;
          const r = h.boxes[i];
          if (r.kind === "coins") {
            st.score += r.amount;
            h.result = { type: "coins", amount: r.amount };
            if (r.amount >= 100) this.hackerFeed({ type: "bonus", by: name, amount: r.amount });
            h.stage = "result";
          } else if (r.kind === "double") {
            const gain = st.score > 0 ? Math.min(st.score, 400) : 20;
            st.score += gain;
            h.result = { type: "double", amount: gain };
            this.hackerFeed({ type: "double", by: name, amount: gain });
            h.stage = "result";
          } else if (r.kind === "hack") {
            if (!this.hackerTargets(id).length) {
              st.score += 25;
              h.result = { type: "noTarget", amount: 25 };
              h.stage = "result";
            } else h.stage = "target";
          } else {
            h.result = { type: "nothing" };
            h.stage = "result";
          }
        } else if (action === "target") {
          if (h.stage !== "target") throw new HackerError("Agora n\xE3o \xE9 hora de hackear.");
          const targetId = String(value || "");
          if (!this.hackerTargets(id).some((t) => t.id === targetId)) throw new HackerError("Escolha algu\xE9m da lista.");
          const target = this.state.get(targetId);
          const decoys = shuffle(
            HACKER_PASSWORDS.filter((w) => w !== target.h.password),
            this.rng
          ).slice(0, 2);
          h.targetId = targetId;
          h.guess = shuffle([target.h.password, ...decoys], this.rng);
          h.stage = "guess";
        } else if (action === "guess") {
          if (h.stage !== "guess" || !h.targetId) throw new HackerError("Escolha quem hackear primeiro.");
          const guess = String(value || "");
          if (!h.guess.includes(guess)) throw new HackerError("Escolha uma das senhas.");
          const target = this.state.get(h.targetId);
          const targetName = (this.competitorInfo(h.targetId) || {}).name || "?";
          if (target && target.h && guess === target.h.password) {
            const amount = Math.max(1, Math.round(target.score * STEAL_SHARE));
            const stolen = Math.min(amount, target.score);
            target.score -= stolen;
            st.score += stolen;
            h.result = { type: "hacked", amount: stolen, target: targetName };
            target.h.notices.push({ at: Date.now(), by: name, amount: stolen });
            target.h.notices = target.h.notices.slice(-3);
            this.hackerFeed({ type: "hack", by: name, target: targetName, amount: stolen });
          } else {
            h.result = { type: "missed", target: targetName };
            this.hackerFeed({ type: "miss", by: name, target: targetName });
          }
          h.stage = "result";
        } else {
          throw new HackerError("A\xE7\xE3o inv\xE1lida.");
        }
        this.changed();
        return { ok: true };
      },
      /** Quem pode ser hackeado: os outros participantes que têm moedas. */
      hackerTargets(selfId) {
        return this.turnOrder.filter((id) => id !== selfId).map((id) => ({ id, st: this.state.get(id), info: this.competitorInfo(id) })).filter((x) => x.st && x.st.h && x.st.score > 0 && x.info).sort((a, b) => b.st.score - a.st.score).map((x) => ({ id: x.id, name: x.info.name, character: x.info.character, color: x.info.color, score: x.st.score }));
      },
      /** O que só o próprio participante vê (pergunta dele, caixas, senha). */
      hackerPlayerView(id) {
        const st = this.state.get(id);
        if (!st || !st.h) return null;
        const h = st.h;
        const q = this.questions[h.q];
        const now = Date.now();
        const view = {
          password: h.password,
          stage: h.stage,
          lockedUntil: h.lockedUntil,
          last: h.last,
          result: h.result,
          notices: h.notices.filter((n) => now - n.at < NOTICE_MS),
          question: q && (h.stage === "question" || h.stage === "wrong") ? {
            key: `${h.q}-${h.pos}`,
            type: q.type,
            text: q.text,
            image: q.image,
            options: q.type === "multiple" ? q.options.filter((o) => o.text).map((o) => ({ id: o.id, text: o.text })) : [],
            correct: h.stage === "wrong" && q.type === "multiple" ? q.correct : void 0
          } : null,
          boxes: h.stage === "result" && h.boxes ? h.boxes.map((r) => rewardLabel(r)) : null,
          boxCount: h.boxes ? h.boxes.length : 0,
          picked: h.picked,
          targets: h.stage === "target" ? this.hackerTargets(id) : null,
          guess: h.stage === "guess" ? { target: (this.competitorInfo(h.targetId) || {}).name || "?", options: h.guess } : null
        };
        return view;
      }
    };
    module2.exports = { hackerMethods, HackerError, REWARDS };
  }
});

// server/game/Room.js
var require_Room = __commonJS({
  "server/game/Room.js"(exports2, module2) {
    "use strict";
    var { CHARACTERS, COLORS, LIMITS, SPUD_EVENTS, POWERUPS } = require_constants();
    var { normalizeAnswer, cleanText, shuffle, randInt, token, uuid } = require_util();
    var { isQuestionReady } = require_validate();
    var { generateBoard } = require_board();
    var { computeMedals } = require_medals();
    var { hackerMethods } = require_hacker();
    var ANSWER_GRACE_MS = 600;
    var MAX_POWERUPS = 3;
    var GameError = class extends Error {
    };
    var Room = class {
      constructor({ code, hostUserId, game, config: config2, rng = Math.random, onChange = () => {
      }, onFinish = () => {
      } }) {
        this.code = code;
        this.hostUserId = hostUserId;
        this.hostToken = token();
        this.gameId = game.id;
        this.gameTitle = game.title;
        this.questions = (game.questions || []).filter(isQuestionReady);
        if (!this.questions.length) throw new GameError("Este jogo ainda n\xE3o tem perguntas completas. Termine pelo menos uma no criador.");
        this.config = config2;
        this.rng = rng;
        this.onChange = onChange;
        this.onFinish = onFinish;
        this.createdAt = Date.now();
        this.lastActivity = Date.now();
        this.hostSockets = /* @__PURE__ */ new Set();
        this.displaySockets = /* @__PURE__ */ new Set();
        this.players = /* @__PURE__ */ new Map();
        this.teams = config2.teams.map((t) => ({ ...t }));
        this.timer = null;
        this.resolutionSeq = 0;
        this.resetGameState();
      }
      // ------------------------------------------------------------------ estado
      resetGameState() {
        clearTimeout(this.timer);
        this.timer = null;
        this.phase = "lobby";
        this.state = /* @__PURE__ */ new Map();
        this.turnOrder = [];
        this.turnPos = -1;
        this.deck = [];
        this.deckPos = 0;
        this.asked = 0;
        this.current = null;
        this.lastResolution = null;
        this.results = null;
        this.finishCount = 0;
        this.board = this.config.mode === "spud" ? generateBoard(this.config.boardLength, {
          eventsEnabled: Object.values(this.config.events).some(Boolean),
          powerupsEnabled: Object.values(this.config.powerups).some(Boolean),
          rng: this.rng
        }) : null;
        this.matchId = null;
        this.round = 1;
        this.hacker = null;
        this.reverseWheel = false;
        this.forcedTarget = null;
      }
      touch() {
        this.lastActivity = Date.now();
      }
      changed() {
        this.touch();
        this.onChange(this);
      }
      get finishIndex() {
        return this.board ? this.board.length - 1 : 0;
      }
      // -------------------------------------------------------------- jogadores
      addPlayer({ name, character, color, teamId }) {
        if (this.config.answerSource === "presenter") {
          throw new GameError("Esta partida \xE9 conduzida pelo apresentador e n\xE3o aceita participantes por celular.");
        }
        if (this.phase === "finished") throw new GameError("Esta partida j\xE1 terminou.");
        const active = [...this.players.values()].filter((p) => !p.kicked);
        if (active.length >= LIMITS.playersPerRoomMax) throw new GameError("A sala est\xE1 cheia.");
        let clean = cleanText(name, LIMITS.playerNameMax);
        if (clean.length < 1) throw new GameError("Digite seu nome para entrar.");
        const taken = new Set(active.map((p) => p.name.toLowerCase()));
        if (taken.has(clean.toLowerCase())) {
          let i = 2;
          const base = clean.slice(0, LIMITS.playerNameMax - 3);
          while (taken.has(`${base} ${i}`.toLowerCase())) i++;
          clean = `${base} ${i}`;
        }
        const player = {
          id: uuid().slice(0, 12),
          token: token(),
          name: clean,
          character: CHARACTERS.some((c) => c.id === character) ? character : CHARACTERS[active.length % CHARACTERS.length].id,
          color: COLORS.includes(color) ? color : COLORS[active.length % COLORS.length],
          teamId: null,
          connected: false,
          socketId: null,
          kicked: false,
          joinedAt: Date.now()
        };
        if (this.config.playStyle === "teams") {
          player.teamId = this.teams.some((t) => t.id === teamId) ? teamId : this.smallestTeam().id;
        }
        this.players.set(player.id, player);
        if (this.phase !== "lobby") {
          this.ensureCompetitor(this.competitorIdOf(player));
          if (this.config.mode === "hacker" && this.phase === "playing") this.hackerInit(this.competitorIdOf(player));
        }
        this.changed();
        return player;
      }
      smallestTeam() {
        const counts = new Map(this.teams.map((t) => [t.id, 0]));
        for (const p of this.players.values()) if (!p.kicked && p.teamId) counts.set(p.teamId, (counts.get(p.teamId) || 0) + 1);
        return this.teams.reduce((best, t) => counts.get(t.id) < counts.get(best.id) ? t : best, this.teams[0]);
      }
      findPlayerByToken(tok) {
        if (typeof tok !== "string") return null;
        for (const p of this.players.values()) if (p.token === tok && !p.kicked) return p;
        return null;
      }
      updatePlayer(playerId, { character, color, teamId }) {
        const p = this.players.get(playerId);
        if (!p || p.kicked) throw new GameError("Participante n\xE3o encontrado.");
        if (character !== void 0 && CHARACTERS.some((c) => c.id === character)) p.character = character;
        if (color !== void 0 && COLORS.includes(color)) p.color = color;
        if (teamId !== void 0 && this.config.playStyle === "teams") {
          if (this.phase !== "lobby") throw new GameError("S\xF3 d\xE1 para trocar de equipe antes do jogo come\xE7ar.");
          if (this.teams.some((t) => t.id === teamId)) p.teamId = teamId;
        }
        this.changed();
      }
      kick(playerId) {
        const p = this.players.get(playerId);
        if (!p) return null;
        p.kicked = true;
        p.connected = false;
        const sid = p.socketId;
        p.socketId = null;
        if (this.config.playStyle === "individual") {
          this.turnOrder = this.turnOrder.filter((id) => id !== p.id);
          if (this.current) this.current.activeIds = this.current.activeIds.filter((id) => id !== p.id);
          this.state.delete(p.id);
        }
        this.checkAllAnswered();
        this.changed();
        return sid;
      }
      setConnected(playerId, socketId) {
        const p = this.players.get(playerId);
        if (!p) return;
        p.connected = !!socketId;
        p.socketId = socketId;
        this.changed();
      }
      // ------------------------------------------------------------ competidores
      competitorIdOf(player) {
        return this.config.playStyle === "teams" ? player.teamId : player.id;
      }
      membersOf(competitorId) {
        return [...this.players.values()].filter((p) => !p.kicked && this.competitorIdOf(p) === competitorId);
      }
      /** Lista de competidores na ordem de turnos. */
      competitorIds() {
        if (this.phase !== "lobby") return this.turnOrder.slice();
        if (this.config.playStyle === "individual") {
          return [...this.players.values()].filter((p) => !p.kicked).map((p) => p.id);
        }
        if (this.config.answerSource === "presenter") return this.teams.map((t) => t.id);
        return this.teams.filter((t) => this.membersOf(t.id).length > 0).map((t) => t.id);
      }
      competitorInfo(id) {
        if (this.config.playStyle === "teams") {
          const t = this.teams.find((x) => x.id === id);
          return t ? { name: t.name, color: t.color, character: t.character } : null;
        }
        const p = this.players.get(id);
        return p ? { name: p.name, color: p.color, character: p.character } : null;
      }
      ensureCompetitor(id) {
        if (!id || this.state.has(id)) return;
        this.state.set(id, {
          score: 0,
          position: 0,
          shield: false,
          skip: 0,
          powerups: [],
          armed: { speed: false, double: false },
          correct: 0,
          answered: 0,
          replied: 0,
          // quantas vezes respondeu de fato
          streak: 0,
          // acertos seguidos agora
          bestStreak: 0,
          fastMs: 0,
          // soma do tempo das respostas certas (para a medalha Relâmpago)
          fastN: 0,
          finishOrder: null,
          offer: null,
          // poderes oferecidos (casa ★) para escolher 1 ou pular
          mods: {}
          // casas alteradas na raia: { indice: 'broken' | 'safe' }
        });
        this.turnOrder.push(id);
      }
      /** Guarda sequência de acertos e rapidez (usados nas medalhas). */
      track(st, ans, correct) {
        if (ans) st.replied++;
        if (correct) {
          st.streak++;
          st.bestStreak = Math.max(st.bestStreak, st.streak);
          if (this.config.answerSource !== "presenter" && ans && ans.at) {
            st.fastMs += Math.max(0, ans.at - this.current.startedAt);
            st.fastN++;
          }
        } else st.streak = 0;
      }
      isAnswerable(id) {
        if (this.config.answerSource === "presenter") return true;
        return this.membersOf(id).some((p) => p.connected);
      }
      // ------------------------------------------------------------------ fluxo
      start() {
        if (this.phase !== "lobby") throw new GameError("A partida j\xE1 come\xE7ou.");
        const ids = this.competitorIds();
        if (ids.length < 1) {
          throw new GameError(
            this.config.playStyle === "teams" ? "Ningu\xE9m entrou nas equipes ainda." : "Espere pelo menos um participante entrar."
          );
        }
        for (const id of ids) this.ensureCompetitor(id);
        if (this.config.mode === "spud" && this.config.startWithPowerup) {
          for (const id of ids) {
            const p = this.randomPowerup();
            if (p) this.state.get(id).powerups.push(p);
          }
        }
        this.matchId = uuid();
        this.startedAt = Date.now();
        if (this.config.mode === "hacker") return this.hackerStart();
        this.buildDeck();
        this.nextQuestion();
      }
      buildDeck() {
        const idx = this.questions.map((_, i) => i);
        const last = this.deck.length ? this.deck[this.deckPos - 1] : null;
        this.deck = this.config.shuffleQuestions ? shuffle(idx, this.rng) : idx;
        if (this.deck.length > 1 && this.deck[0] === last) this.deck.push(this.deck.shift());
        this.deckPos = 0;
      }
      totalQuestions() {
        if (this.config.mode !== "classic") return null;
        const limit = this.config.questionLimit;
        return limit > 0 ? Math.min(limit, this.questions.length) : this.questions.length;
      }
      nextQuestion() {
        clearTimeout(this.timer);
        if (this.config.mode === "classic" && this.asked >= this.totalQuestions()) return this.finish();
        if (this.deckPos >= this.deck.length) this.buildDeck();
        const qIndex = this.deck[this.deckPos++];
        this.asked++;
        const q = this.questions[qIndex];
        const skipped = [];
        let activeIds;
        if (this.config.turnStyle === "turns") {
          activeIds = [];
          for (let guard = 0; guard < this.turnOrder.length * 2 + 2 && !activeIds.length; guard++) {
            this.turnPos = (this.turnPos + 1) % this.turnOrder.length;
            const id = this.turnOrder[this.turnPos];
            const st = this.state.get(id);
            if (!st) continue;
            if (st.skip > 0) {
              st.skip--;
              skipped.push(id);
              continue;
            }
            activeIds.push(id);
          }
          if (!activeIds.length) activeIds = [this.turnOrder[this.turnPos]];
        } else {
          activeIds = [];
          for (const id of this.turnOrder) {
            const st = this.state.get(id);
            if (st.skip > 0) {
              st.skip--;
              skipped.push(id);
            } else activeIds.push(id);
          }
          if (!activeIds.length) activeIds = this.turnOrder.slice();
        }
        const seconds = q.time || this.config.timer;
        const now = Date.now();
        this.current = {
          num: this.asked,
          qIndex,
          question: q,
          startedAt: now,
          seconds,
          deadline: seconds > 0 ? now + seconds * 1e3 : null,
          activeIds,
          skipped,
          answers: /* @__PURE__ */ new Map(),
          results: null
        };
        this.phase = "question";
        this.lastResolution = null;
        if (seconds > 0) this.timer = setTimeout(() => this.safeReveal(), seconds * 1e3 + ANSWER_GRACE_MS);
        this.changed();
      }
      safeReveal() {
        try {
          if (this.phase === "question") this.reveal();
        } catch (err) {
          console.error("[sala] erro ao revelar:", err);
        }
      }
      // --------------------------------------------------------------- respostas
      checkAnswer(q, value) {
        if (q.type === "multiple") {
          const opt = q.options.find((o) => o.id === value);
          if (!opt) throw new GameError("Alternativa inv\xE1lida.");
          return { correct: opt.id === q.correct, text: opt.text, value: opt.id };
        }
        const text = cleanText(value, LIMITS.optionTextMax);
        if (!text) throw new GameError("Digite uma resposta.");
        const norm = normalizeAnswer(text);
        return { correct: q.answers.some((a) => normalizeAnswer(a) === norm), text, value: text };
      }
      /** Resposta enviada por um participante pelo celular/computador. */
      submitAnswer(playerId, value) {
        const p = this.players.get(playerId);
        if (!p || p.kicked) throw new GameError("Participante n\xE3o encontrado.");
        if (this.phase !== "question" || !this.current) throw new GameError("N\xE3o h\xE1 pergunta aberta agora.");
        if (this.current.deadline && Date.now() > this.current.deadline + ANSWER_GRACE_MS) {
          throw new GameError("O tempo acabou!");
        }
        const compId = this.competitorIdOf(p);
        if (!this.current.activeIds.includes(compId)) throw new GameError("Agora n\xE3o \xE9 a sua vez.");
        if (this.current.answers.has(compId)) throw new GameError("Sua resposta j\xE1 foi registrada.");
        const res = this.checkAnswer(this.current.question, value);
        this.current.answers.set(compId, { ...res, playerId, by: p.name, at: Date.now() });
        if (!this.checkAllAnswered()) this.changed();
        return { received: true };
      }
      /** Modo apresentador: o administrador registra a resposta da equipe da vez. */
      presenterAnswer({ competitorId, value, judge }) {
        if (this.config.answerSource !== "presenter") throw new GameError("Esta partida usa respostas pelos celulares.");
        if (this.phase !== "question" || !this.current) throw new GameError("N\xE3o h\xE1 pergunta aberta agora.");
        const compId = competitorId || this.current.activeIds[0];
        if (!this.current.activeIds.includes(compId)) throw new GameError("N\xE3o \xE9 a vez desta equipe.");
        if (this.current.answers.has(compId)) throw new GameError("Resposta j\xE1 registrada.");
        const q = this.current.question;
        let res;
        if (q.type === "open" && typeof judge === "boolean") {
          res = { correct: judge, text: judge ? "Correta (avaliada pelo apresentador)" : "Incorreta", value: null };
        } else {
          res = this.checkAnswer(q, value);
        }
        this.current.answers.set(compId, { ...res, playerId: null, by: "Apresentador", at: Date.now() });
        if (!this.checkAllAnswered()) this.changed();
      }
      checkAllAnswered() {
        if (this.phase !== "question" || !this.current) return false;
        const pending = this.current.activeIds.filter((id) => !this.current.answers.has(id) && this.isAnswerable(id));
        if (pending.length === 0 && this.current.answers.size > 0) {
          this.reveal();
          return true;
        }
        return false;
      }
      reveal() {
        if (this.phase !== "question") throw new GameError("N\xE3o h\xE1 pergunta aberta para revelar.");
        clearTimeout(this.timer);
        if (this.config.mode === "classic") this.revealClassic();
        else this.resolveSpud();
      }
      next() {
        if (this.phase === "question") throw new GameError("Revele a resposta antes de seguir.");
        if (this.phase !== "reveal") throw new GameError("N\xE3o d\xE1 para avan\xE7ar agora.");
        this.nextQuestion();
      }
      // ----------------------------------------------------------- Classic Quiz
      revealClassic() {
        const q = this.current.question;
        const results = {};
        for (const id of this.current.activeIds) {
          const st = this.state.get(id);
          if (!st) continue;
          const ans = this.current.answers.get(id);
          st.answered++;
          this.track(st, ans, !!(ans && ans.correct));
          let points = 0;
          if (ans && ans.correct) {
            points = q.points;
            if (this.config.speedBonus && this.current.deadline) {
              const total = this.current.seconds * 1e3;
              const left = Math.max(0, this.current.deadline - ans.at);
              points += Math.round(q.points * 0.5 * (left / total));
            }
            st.score += points;
            st.correct++;
          }
          results[id] = { correct: !!(ans && ans.correct), answered: !!ans, points, answer: ans ? ans.text : null, by: ans ? ans.by : null };
        }
        this.current.results = results;
        this.phase = "reveal";
        if (this.asked >= this.totalQuestions()) this.current.isLast = true;
        this.changed();
      }
      // -------------------------------------------------------------- Spud Game
      positions() {
        const out = {};
        for (const [id, st] of this.state) out[id] = st.position;
        return out;
      }
      randomPowerup() {
        const enabled = Object.keys(POWERUPS).filter((k) => this.config.powerups && this.config.powerups[k]);
        return enabled.length ? enabled[Math.floor(this.rng() * enabled.length)] : null;
      }
      randomPowerups(n) {
        const enabled = Object.keys(POWERUPS).filter((k) => this.config.powerups && this.config.powerups[k]);
        return shuffle(enabled, this.rng).slice(0, n);
      }
      /** Tipo efetivo da casa na raia de um competidor (considera casas pintadas/quebradas). */
      tileAt(id, i) {
        const st = this.state.get(id);
        const mod = st && st.mods ? st.mods[i] : null;
        return mod || this.board[i];
      }
      enabledEvents() {
        return Object.keys(SPUD_EVENTS).filter((k) => this.config.events[k]);
      }
      resolveSpud() {
        const q = this.current.question;
        const steps = [];
        const start = this.positions();
        const results = {};
        const ctx = { steps, winner: null };
        const order = this.current.activeIds.slice().sort((a, b) => {
          const A = this.current.answers.get(a);
          const B = this.current.answers.get(b);
          return (A ? A.at : Infinity) - (B ? B.at : Infinity);
        });
        for (const id of order) {
          const st = this.state.get(id);
          if (!st) continue;
          const ans = this.current.answers.get(id);
          st.answered++;
          const correct = !!(ans && ans.correct);
          this.track(st, ans, correct);
          results[id] = { correct, answered: !!ans, points: 0, answer: ans ? ans.text : null, by: ans ? ans.by : null };
          if (ctx.winner) continue;
          if (correct) {
            st.correct++;
            let points = q.points;
            if (st.armed.double) {
              points *= 2;
              st.armed.double = false;
              steps.push(this.step("doubled", id, { points }));
            }
            st.score += points;
            results[id].points = points;
            let move;
            if (this.config.movement === "dice") {
              move = randInt(1, 6, this.rng);
              steps.push(this.step("dice", id, { value: move }));
            } else {
              move = this.config.fixedSteps;
            }
            if (st.armed.speed) {
              st.armed.speed = false;
              move += 3;
              steps.push(this.step("boost", id, { extra: 3 }));
            }
            this.moveBy(id, move, ctx, { reason: "correct", landing: true });
          } else {
            const back = Math.min(this.config.wrongPenalty, st.position);
            if (back > 0) {
              const from = st.position;
              st.position -= back;
              steps.push(this.step("wrong", id, { from, to: st.position }));
            } else {
              steps.push(this.step("miss", id, {}));
            }
          }
        }
        const roundEnd = this.config.turnStyle !== "turns" || this.turnOrder.slice(this.turnPos + 1).every((id) => {
          const st = this.state.get(id);
          return !st || st.skip > 0;
        });
        if (!ctx.winner && roundEnd) {
          this.deathWheel(ctx);
          this.round++;
        }
        this.current.results = results;
        this.lastResolution = { id: ++this.resolutionSeq, kind: "answer", start, steps };
        if (ctx.winner) {
          this.phase = "reveal";
          this.finish(ctx.winner);
          return;
        }
        this.phase = "reveal";
        this.changed();
      }
      step(type, competitorId, data) {
        return { type, competitorId, ...data, positions: this.positions(), scores: this.scoresSnapshot() };
      }
      scoresSnapshot() {
        const out = {};
        for (const [id, st] of this.state) out[id] = st.score;
        return out;
      }
      moveBy(id, amount, ctx, { landing }) {
        const st = this.state.get(id);
        const from = st.position;
        let to = Math.max(0, Math.min(this.finishIndex, st.position + amount));
        let broken = false;
        for (let i = from + 1; i <= to; i++) {
          if (st.mods[i] === "broken") {
            to = i;
            broken = true;
            delete st.mods[i];
            break;
          }
        }
        st.position = to;
        ctx.steps.push(this.step("move", id, { from, to: st.position }));
        if (broken) {
          ctx.steps.push(this.step("broken_stop", id, { at: to }));
          return;
        }
        if (st.position >= this.finishIndex) {
          st.finishOrder = ++this.finishCount;
          ctx.winner = id;
          ctx.steps.push(this.step("finish", id, {}));
          return;
        }
        if (landing) this.applyTile(id, ctx);
      }
      /** Efeito ao cair em uma casa (somente após o movimento normal, sem reação em cadeia). */
      applyTile(id, ctx) {
        const st = this.state.get(id);
        const tile = this.tileAt(id, st.position);
        if (tile === "danger" && this.config.deathWheel) {
          ctx.steps.push(this.step("danger_land", id, {}));
        } else if (tile === "danger") {
          if (this.consumeShield(id, ctx, "danger")) return;
          const back = randInt(2, 3, this.rng);
          const from = st.position;
          st.position = Math.max(0, st.position - back);
          ctx.steps.push(this.step("danger", id, { from, to: st.position, amount: back }));
        } else if (tile === "event") {
          const options = this.enabledEvents();
          if (!options.length) return;
          const event = options[Math.floor(this.rng() * options.length)];
          ctx.steps.push(this.step("roulette", id, { event, options }));
          this.applyEvent(id, event, ctx);
        } else if (tile === "power") {
          const options = this.randomPowerups(3);
          if (!options.length) return;
          st.offer = options;
          ctx.steps.push(this.step("offer", id, { options }));
        }
      }
      /** Roda da morte: gira no fim da rodada se alguém estiver numa casa vermelha (ou houver um alvo marcado). */
      deathWheel(ctx) {
        if (!this.config.deathWheel) {
          this.forcedTarget = null;
          this.reverseWheel = false;
          return;
        }
        const ids = this.turnOrder.filter((id) => this.state.has(id));
        const onRed = ids.filter((id) => this.tileAt(id, this.state.get(id).position) === "danger");
        const forced = this.forcedTarget && this.state.has(this.forcedTarget) ? this.forcedTarget : null;
        const names = [...new Set(forced ? [...onRed, forced] : onRed)];
        if (!names.length) return;
        const safeCount = Math.max(2, names.length);
        const slices = [];
        for (let i = 0; i < Math.max(names.length, safeCount); i++) {
          if (i < names.length) slices.push(names[i]);
          if (i < safeCount) slices.push(null);
        }
        const pick = forced ? slices.indexOf(forced) : Math.floor(this.rng() * slices.length);
        const pickedId = slices[pick];
        const reversed = this.reverseWheel;
        ctx.steps.push(this.step("deathwheel", pickedId, { slices, pick, reversed, forced: !!forced }));
        this.reverseWheel = false;
        this.forcedTarget = null;
        if (!pickedId) return;
        if (this.consumeShield(pickedId, ctx, "death")) return;
        if (reversed) {
          this.moveBy(pickedId, 5, ctx, { landing: false });
          return;
        }
        const st = this.state.get(pickedId);
        const from = st.position;
        st.position = 0;
        ctx.steps.push(this.step("death", pickedId, { from, to: 0 }));
      }
      /** Escolher um dos poderes oferecidos (ou pular, choice = null). */
      pickPowerup(actor, { competitorId, choice }) {
        if (this.config.mode !== "spud") throw new GameError("Poderes s\xF3 existem no Spud Game.");
        if (!["question", "reveal"].includes(this.phase)) throw new GameError("Agora n\xE3o d\xE1 para escolher poderes.");
        const compId = this.actorCompetitor(actor, competitorId);
        const st = this.state.get(compId);
        if (!st) throw new GameError("Competidor n\xE3o encontrado.");
        if (!st.offer || !st.offer.length) throw new GameError("N\xE3o h\xE1 poderes para escolher.");
        if (choice) {
          if (!st.offer.includes(choice)) throw new GameError("Escolha um dos poderes oferecidos.");
          if (st.powerups.length >= MAX_POWERUPS) throw new GameError("Voc\xEA j\xE1 tem 3 poderes guardados. Use um antes ou pule.");
          st.powerups.push(choice);
        }
        st.offer = null;
        this.changed();
      }
      actorCompetitor(actor, competitorId) {
        if (actor.type === "player") {
          const p = this.players.get(actor.playerId);
          if (!p || p.kicked) throw new GameError("Participante n\xE3o encontrado.");
          return this.competitorIdOf(p);
        }
        return competitorId;
      }
      consumeShield(id, ctx, against) {
        const st = this.state.get(id);
        if (!st.shield) return false;
        st.shield = false;
        ctx.steps.push(this.step("shield", id, { against }));
        return true;
      }
      applyEvent(id, event, ctx) {
        const st = this.state.get(id);
        switch (event) {
          case "advance": {
            const n = randInt(2, 4, this.rng);
            this.moveBy(id, n, ctx, { landing: false });
            break;
          }
          case "back": {
            if (this.consumeShield(id, ctx, "back")) break;
            const n = randInt(2, 3, this.rng);
            this.moveBy(id, -n, ctx, { landing: false });
            break;
          }
          case "skip": {
            if (this.consumeShield(id, ctx, "skip")) break;
            st.skip = 1;
            ctx.steps.push(this.step("skip", id, {}));
            break;
          }
          case "points": {
            st.score += 20;
            ctx.steps.push(this.step("points", id, { points: 20 }));
            break;
          }
          case "swap": {
            const others = this.turnOrder.filter((o) => o !== id && this.state.has(o));
            if (!others.length) {
              ctx.steps.push(this.step("nothing", id, {}));
              break;
            }
            const target = others[Math.floor(this.rng() * others.length)];
            this.swapPositions(id, target, ctx);
            break;
          }
          case "shuffle":
            this.shufflePositions(id, ctx);
            break;
          default:
            break;
        }
      }
      swapPositions(a, b, ctx) {
        const A = this.state.get(a);
        const B = this.state.get(b);
        if (B.position < A.position && this.consumeShield(a, ctx, "swap")) return;
        if (A.position < B.position && this.consumeShield(b, ctx, "swap")) return;
        const pa = A.position;
        A.position = B.position;
        B.position = pa;
        ctx.steps.push(this.step("swap", a, { targetId: b }));
      }
      shufflePositions(by, ctx) {
        const ids = this.turnOrder.filter((id) => this.state.has(id));
        const before = ids.map((id) => this.state.get(id).position);
        const after = shuffle(before, this.rng);
        const protectedIds = [];
        ids.forEach((id, i) => {
          const st = this.state.get(id);
          if (after[i] < st.position && st.shield) {
            st.shield = false;
            protectedIds.push(id);
            return;
          }
          st.position = after[i];
        });
        ctx.steps.push(this.step("shuffle", by, { protectedIds }));
      }
      /** Até 2 casas à frente de alguém (2 e 4 casas adiante) que podem ser quebradas. */
      breakableTiles(id) {
        const st = this.state.get(id);
        const out = [];
        for (const d of [2, 4, 3, 5]) {
          const i = st.position + d;
          if (i > 0 && i < this.finishIndex && st.mods[i] !== "broken" && !out.includes(i)) out.push(i);
          if (out.length === 2) break;
        }
        return out.sort((a, b) => a - b);
      }
      /** Usar um poder. actor = { type: 'player', playerId } | { type: 'host' }. */
      usePowerup(actor, { competitorId, powerup, targetId }) {
        if (this.config.mode !== "spud") throw new GameError("Poderes s\xF3 existem no Spud Game.");
        if (this.phase !== "question" || !this.current) throw new GameError("Use os poderes enquanto a pergunta estiver aberta.");
        const compId = this.actorCompetitor(actor, competitorId);
        const st = this.state.get(compId);
        if (!st) throw new GameError("Competidor n\xE3o encontrado.");
        if (!this.current.activeIds.includes(compId)) throw new GameError("Voc\xEA s\xF3 pode usar poderes na sua vez.");
        if (this.current.answers.has(compId)) throw new GameError("Use o poder antes de responder.");
        const idx = st.powerups.indexOf(powerup);
        if (idx === -1) throw new GameError("Voc\xEA n\xE3o tem esse poder.");
        if (!this.config.powerups[powerup]) throw new GameError("Este poder est\xE1 desativado nesta partida.");
        const ctx = { steps: [], winner: null };
        const start = this.positions();
        switch (powerup) {
          case "speed":
            if (st.armed.speed) throw new GameError("O Speed Boost j\xE1 est\xE1 ativo.");
            st.armed.speed = true;
            break;
          case "double":
            if (st.armed.double) throw new GameError("O Double Points j\xE1 est\xE1 ativo.");
            st.armed.double = true;
            break;
          case "shield":
            if (st.shield) throw new GameError("O escudo j\xE1 est\xE1 ativo.");
            st.shield = true;
            break;
          case "swap": {
            if (!targetId || targetId === compId || !this.state.has(targetId)) throw new GameError("Escolha com quem trocar de lugar.");
            break;
          }
          case "shuffle":
            if (this.state.size < 2) throw new GameError("\xC9 preciso ter pelo menos dois participantes.");
            break;
          case "break": {
            if (!targetId || targetId === compId || !this.state.has(targetId)) throw new GameError("Escolha em qual raia quebrar as casas.");
            var breakTiles = this.breakableTiles(targetId);
            if (!breakTiles.length) throw new GameError("N\xE3o h\xE1 casas para quebrar na frente desse participante.");
            break;
          }
          case "target":
            if (!targetId || targetId === compId || !this.state.has(targetId)) throw new GameError("Escolha quem ser\xE1 o alvo da roda da morte.");
            if (!this.config.deathWheel) throw new GameError("A roda da morte est\xE1 desligada nesta partida.");
            break;
          case "reverse":
            if (!this.config.deathWheel) throw new GameError("A roda da morte est\xE1 desligada nesta partida.");
            if (this.reverseWheel) throw new GameError("A roda da morte j\xE1 est\xE1 invertida.");
            break;
          case "leap": {
            const others = this.turnOrder.filter((o) => o !== compId && this.state.has(o)).map((o) => this.state.get(o).position);
            var leapTo = others.length ? Math.min(this.finishIndex - 1, Math.max(...others) + 1) : -1;
            if (leapTo <= st.position) throw new GameError("Voc\xEA j\xE1 est\xE1 na frente de todo mundo!");
            break;
          }
          case "paint": {
            var paintAt = -1;
            for (let i = st.position; i < this.finishIndex; i++) {
              if (this.tileAt(compId, i) === "danger") {
                paintAt = i;
                break;
              }
            }
            if (paintAt < 0) throw new GameError("N\xE3o h\xE1 casa vermelha na sua frente para pintar.");
            break;
          }
          default:
            throw new GameError("Poder desconhecido.");
        }
        st.powerups.splice(idx, 1);
        ctx.steps.push(this.step("power", compId, { powerup, targetId: targetId || null }));
        if (powerup === "swap") this.swapPositions(compId, targetId, ctx);
        if (powerup === "shuffle") this.shufflePositions(compId, ctx);
        if (powerup === "break" && !this.consumeShield(targetId, ctx, "break")) {
          const target = this.state.get(targetId);
          breakTiles.forEach((i) => target.mods[i] = "broken");
          ctx.steps.push(this.step("break", compId, { targetId, tiles: breakTiles }));
        }
        if (powerup === "target") {
          this.forcedTarget = targetId;
          ctx.steps.push(this.step("target", compId, { targetId }));
        }
        if (powerup === "reverse") {
          this.reverseWheel = true;
          ctx.steps.push(this.step("reverse", compId, {}));
        }
        if (powerup === "leap") {
          const from = st.position;
          st.position = leapTo;
          ctx.steps.push(this.step("leap", compId, { from, to: leapTo }));
        }
        if (powerup === "paint") {
          st.mods[paintAt] = "safe";
          ctx.steps.push(this.step("paint", compId, { at: paintAt }));
        }
        this.lastResolution = { id: ++this.resolutionSeq, kind: "power", start, steps: ctx.steps };
        this.changed();
      }
      // ------------------------------------------------------------------- fim
      ranking() {
        const ids = this.turnOrder.filter((id) => this.state.has(id));
        const rows = ids.map((id) => {
          const st = this.state.get(id);
          const info = this.competitorInfo(id) || { name: "?", color: "#999", character: "tuca" };
          return {
            id,
            ...info,
            score: st.score,
            position: st.position,
            correct: st.correct,
            answered: st.answered,
            finishOrder: st.finishOrder,
            members: this.config.playStyle === "teams" ? this.membersOf(id).map((p) => p.name) : []
          };
        });
        if (this.config.mode === "spud") {
          rows.sort(
            (a, b) => (a.finishOrder || Infinity) - (b.finishOrder || Infinity) || b.position - a.position || b.score - a.score
          );
        } else {
          rows.sort((a, b) => b.score - a.score || b.correct - a.correct);
        }
        let place = 0;
        rows.forEach((r, i) => {
          const prev = rows[i - 1];
          const tie = prev && (this.config.mode === "spud" ? !r.finishOrder && !prev.finishOrder && prev.position === r.position && prev.score === r.score : prev.score === r.score && prev.correct === r.correct);
          place = tie ? place : i + 1;
          r.place = place;
        });
        return rows;
      }
      finish(winnerId = null) {
        if (this.phase === "finished") return;
        clearTimeout(this.timer);
        this.phase = "finished";
        const ranking = this.ranking();
        const medals = computeMedals(
          ranking.map((r) => {
            const st = this.state.get(r.id) || {};
            return { id: r.id, place: r.place, asked: st.answered || 0, replied: st.replied || 0, correct: st.correct || 0, bestStreak: st.bestStreak || 0, fastMs: st.fastMs || 0, fastN: st.fastN || 0 };
          })
        );
        for (const r of ranking) r.medals = medals[r.id] || [];
        this.results = { winnerId, ranking, finishedAt: Date.now() };
        this.changed();
        try {
          this.onFinish(this);
        } catch (err) {
          console.error("[sala] erro ao salvar resultado:", err);
        }
      }
      end() {
        if (this.phase === "lobby") throw new GameError("A partida ainda n\xE3o come\xE7ou.");
        this.finish(null);
      }
      restart() {
        if (this.phase === "lobby") return;
        this.resetGameState();
        this.changed();
      }
      // ------------------------------------------------------------------ views
      competitorsView() {
        return this.competitorIds().map((id) => {
          const info = this.competitorInfo(id);
          if (!info) return null;
          const st = this.state.get(id);
          const members = this.config.playStyle === "teams" ? this.membersOf(id) : [];
          return {
            id,
            ...info,
            score: st ? st.score : 0,
            position: st ? st.position : 0,
            shield: st ? st.shield : false,
            skip: st ? st.skip : 0,
            powerups: st ? st.powerups.slice() : [],
            armed: st ? { ...st.armed } : { speed: false, double: false },
            offer: st && st.offer ? st.offer.slice() : null,
            mods: st ? { ...st.mods } : {},
            correct: st ? st.correct : 0,
            connected: this.isAnswerable(id),
            members: members.map((m) => ({ id: m.id, name: m.name, connected: m.connected }))
          };
        }).filter(Boolean);
      }
      questionView(withAnswer) {
        const c = this.current;
        if (!c) return null;
        const q = c.question;
        const reveal = withAnswer || this.phase !== "question";
        const view = {
          num: c.num,
          total: this.totalQuestions(),
          type: q.type,
          text: q.text,
          image: q.image,
          points: q.points,
          options: q.type === "multiple" ? q.options.filter((o) => o.text).map((o) => ({ id: o.id, text: o.text })) : [],
          seconds: c.seconds,
          startedAt: c.startedAt,
          deadline: c.deadline,
          activeIds: c.activeIds,
          skipped: c.skipped,
          answeredIds: [...c.answers.keys()],
          isLast: !!c.isLast
        };
        if (reveal) {
          view.correct = q.type === "multiple" ? q.correct : null;
          view.acceptedAnswers = q.type === "open" ? q.answers : [];
        }
        if (this.phase !== "question") view.results = c.results;
        return view;
      }
      baseView(role) {
        return {
          code: this.code,
          role,
          gameTitle: this.gameTitle,
          phase: this.phase,
          serverNow: Date.now(),
          config: this.config,
          questionCount: this.questions.length,
          teams: this.teams,
          players: [...this.players.values()].filter((p) => !p.kicked).map((p) => ({ id: p.id, name: p.name, character: p.character, color: p.color, teamId: p.teamId, connected: p.connected })),
          competitors: this.competitorsView(),
          board: this.board,
          spud: this.config.mode === "spud" ? { round: this.round, reverseWheel: this.reverseWheel, forcedTarget: this.forcedTarget } : null,
          question: this.questionView(role === "host"),
          hacker: this.hacker ? { endsAt: this.hacker.endsAt, feed: this.hacker.feed.slice(0, 8) } : null,
          lastResolution: this.lastResolution,
          results: this.results
        };
      }
      hostView() {
        const v = this.baseView("host");
        if (this.current && this.phase === "question") {
          v.liveAnswers = Object.fromEntries(
            [...this.current.answers.entries()].map(([id, a]) => [id, { by: a.by, text: a.text, correct: a.correct }])
          );
        }
        return v;
      }
      displayView() {
        return this.baseView("display");
      }
      playerView(playerId) {
        const v = this.baseView("player");
        const p = this.players.get(playerId);
        if (!p) return v;
        const compId = this.competitorIdOf(p);
        const ans = this.current ? this.current.answers.get(compId) : null;
        v.you = {
          playerId: p.id,
          name: p.name,
          character: p.character,
          color: p.color,
          teamId: p.teamId,
          competitorId: compId,
          myTurn: !!(this.current && this.phase === "question" && this.current.activeIds.includes(compId)),
          answered: !!ans,
          answer: ans ? { text: ans.text, value: ans.value, by: ans.by } : null,
          password: this.config.mode === "hacker" ? p.password || null : void 0,
          hacker: this.config.mode === "hacker" ? this.hackerPlayerView(compId) : void 0
        };
        return v;
      }
    };
    Object.assign(Room.prototype, hackerMethods);
    module2.exports = { Room, GameError };
  }
});

// server/game/RoomManager.js
var require_RoomManager = __commonJS({
  "server/game/RoomManager.js"(exports2, module2) {
    "use strict";
    var { Room } = require_Room();
    var { randomCode } = require_util();
    var IDLE_LIMIT_MS = 3 * 60 * 60 * 1e3;
    var EMPTY_LIMIT_MS = 30 * 60 * 1e3;
    var RoomManager = class {
      constructor() {
        this.rooms = /* @__PURE__ */ new Map();
        this.sweeper = setInterval(() => this.sweep(), 60 * 1e3);
        this.sweeper.unref();
      }
      create(opts) {
        let code;
        do
          code = randomCode(6);
        while (this.rooms.has(code));
        const room = new Room({ ...opts, code });
        this.rooms.set(code, room);
        return room;
      }
      get(code) {
        if (typeof code !== "string") return null;
        return this.rooms.get(code.trim().toUpperCase()) || null;
      }
      remove(code) {
        const room = this.rooms.get(code);
        if (room) clearTimeout(room.timer);
        this.rooms.delete(code);
      }
      sweep(now = Date.now()) {
        for (const [code, room] of this.rooms) {
          const idle = now - room.lastActivity;
          const anyoneHere = room.hostSockets && room.hostSockets.size > 0;
          if (idle > IDLE_LIMIT_MS || !anyoneHere && idle > EMPTY_LIMIT_MS) this.remove(code);
        }
      }
    };
    module2.exports = { RoomManager };
  }
});

// server/game/config.js
var require_config2 = __commonJS({
  "server/game/config.js"(exports2, module2) {
    "use strict";
    var { SPUD_EVENTS, POWERUPS, COLORS, CHARACTERS, LIMITS } = require_constants();
    var { cleanText, clampInt } = require_util();
    var DEFAULT_TEAM_NAMES = ["Equipe Milho", "Equipe Chiclete", "Equipe Menta", "Equipe C\xE9u", "Equipe Uva", "Equipe Laranja"];
    var TEAM_COLORS = ["#FFB627", "#FF5D8F", "#3DDC97", "#4CC9F0", "#9B5DE5", "#FF7B39"];
    var TEAM_CHARACTERS = ["tuca", "bolota", "pingo", "zeze", "nino", "rex"];
    function bool(v, fallback) {
      return typeof v === "boolean" ? v : fallback;
    }
    function sanitizeFlags(input, catalog, fallback = true) {
      const src = input && typeof input === "object" ? input : {};
      const out = {};
      for (const key of Object.keys(catalog)) out[key] = bool(src[key], fallback);
      return out;
    }
    function sanitizeTeams(input, count) {
      const list = Array.isArray(input) ? input : [];
      const n = clampInt(count != null ? count : list.length || 2, LIMITS.teamsMin, LIMITS.teamsMax, 2);
      const teams = [];
      for (let i = 0; i < n; i++) {
        const t = list[i] && typeof list[i] === "object" ? list[i] : {};
        teams.push({
          id: `t${i + 1}`,
          name: cleanText(t.name, LIMITS.teamNameMax) || DEFAULT_TEAM_NAMES[i],
          color: COLORS.includes(t.color) ? t.color : TEAM_COLORS[i],
          character: CHARACTERS.some((c) => c.id === t.character) ? t.character : TEAM_CHARACTERS[i]
        });
      }
      return teams;
    }
    function sanitizeRoomConfig(input, gameSettings = {}) {
      const c = input && typeof input === "object" ? input : {};
      const mode = ["classic", "hacker"].includes(c.mode) ? c.mode : "spud";
      const answerSource = mode !== "hacker" && c.answerSource === "presenter" ? "presenter" : "devices";
      const playStyle = mode === "hacker" ? "individual" : answerSource === "presenter" ? "teams" : c.playStyle === "teams" ? "teams" : "individual";
      const defaultTime = clampInt(gameSettings.defaultTime, 0, 300, 20);
      const config2 = {
        mode,
        answerSource,
        playStyle,
        teams: playStyle === "teams" ? sanitizeTeams(c.teams, c.teamCount) : [],
        timer: c.timer === void 0 ? defaultTime : clampInt(c.timer, 0, 300, defaultTime),
        shuffleQuestions: bool(c.shuffleQuestions, true)
      };
      if (mode === "hacker") {
        config2.hackerMinutes = [3, 5, 7, 10, 15].includes(Number(c.hackerMinutes)) ? Number(c.hackerMinutes) : 5;
        config2.timer = 0;
        config2.turnStyle = "rounds";
      } else if (mode === "classic") {
        config2.speedBonus = bool(c.speedBonus, true);
        config2.questionLimit = clampInt(c.questionLimit, 0, 300, 0);
        config2.turnStyle = answerSource === "presenter" ? "turns" : "rounds";
      } else {
        config2.turnStyle = answerSource === "presenter" ? "turns" : c.turnStyle === "turns" ? "turns" : "rounds";
        config2.boardLength = [20, 30, 40].includes(Number(c.boardLength)) ? Number(c.boardLength) : 30;
        config2.movement = c.movement === "fixed" ? "fixed" : "dice";
        config2.fixedSteps = clampInt(c.fixedSteps, 1, 6, 3);
        config2.wrongPenalty = clampInt(c.wrongPenalty, 0, 2, 0);
        config2.events = sanitizeFlags(c.events, SPUD_EVENTS);
        config2.powerups = sanitizeFlags(c.powerups, POWERUPS);
        config2.startWithPowerup = bool(c.startWithPowerup, false);
        config2.deathWheel = bool(c.deathWheel, true);
      }
      return config2;
    }
    module2.exports = { sanitizeRoomConfig, sanitizeTeams };
  }
});

// server/sockets.js
var require_sockets = __commonJS({
  "server/sockets.js"(exports2, module2) {
    "use strict";
    var store2 = require_store();
    var { userIdFromCookieHeader, verifyToken } = require_auth();
    var { RoomManager } = require_RoomManager();
    var { GameError } = require_Room();
    var { HackerError } = require_hacker();
    var { sanitizeRoomConfig, sanitizeTeams } = require_config2();
    var { isUuid, uuid } = require_util();
    var manager = new RoomManager();
    var DISCONNECT_GRACE_MS = 8e3;
    function safeAck(ack) {
      return typeof ack === "function" ? ack : () => {
      };
    }
    function errorMessage(err) {
      if (err instanceof GameError || err instanceof HackerError) return err.message;
      console.error("[socket] erro inesperado:", err);
      return "Algo deu errado no servidor. Tente de novo.";
    }
    function setup(io) {
      function broadcast(room) {
        if (room._broadcastQueued) return;
        room._broadcastQueued = true;
        setImmediate(() => {
          room._broadcastQueued = false;
          if (!manager.rooms.has(room.code)) return;
          const hostView = room.hostView();
          for (const sid of room.hostSockets) io.to(sid).emit("room:state", hostView);
          if (room.displaySockets.size) {
            const displayView = room.displayView();
            for (const sid of room.displaySockets) io.to(sid).emit("room:state", displayView);
          }
          for (const p of room.players.values()) {
            if (p.socketId && !p.kicked) io.to(p.socketId).emit("room:state", room.playerView(p.id));
          }
        });
      }
      async function saveMatch(room) {
        const results = room.results.ranking.map((r) => ({
          place: r.place,
          score: r.score,
          position: r.position,
          correct: r.correct
        }));
        const id = room.matchId || uuid();
        store2.state.matches[id] = {
          id,
          owner_id: room.hostUserId,
          game_id: room.gameId,
          game_title: room.gameTitle,
          mode: room.config.mode,
          results,
          started_at: new Date(room.startedAt || Date.now()).toISOString(),
          finished_at: store2.now()
        };
        const owner = store2.state.users[room.hostUserId];
        if (owner && room.countedMatchId !== id) {
          owner.match_count = (owner.match_count || Object.values(store2.state.matches).filter((m) => m.owner_id === owner.id).length - 1) + 1;
          room.countedMatchId = id;
        }
        const mine = Object.values(store2.state.matches).filter((m) => m.owner_id === room.hostUserId).sort((a, b) => a.finished_at < b.finished_at ? 1 : -1);
        for (const old of mine.slice(60)) delete store2.state.matches[old.id];
        await store2.save();
      }
      function attachSocketToRoom(socket, room, role, playerId = null) {
        socket.join(`room:${room.code}`);
        socket.data.code = room.code;
        socket.data.role = role;
        socket.data.playerId = playerId;
        if (role === "host") room.hostSockets.add(socket.id);
        if (role === "display") room.displaySockets.add(socket.id);
      }
      function detach(socket) {
        const room = manager.get(socket.data.code);
        if (!room) return;
        if (socket.data.role === "host") room.hostSockets.delete(socket.id);
        if (socket.data.role === "display") room.displaySockets.delete(socket.id);
        if (socket.data.role === "player") {
          const p = room.players.get(socket.data.playerId);
          if (p && p.socketId === socket.id) {
            room.setConnected(p.id, null);
            setTimeout(() => {
              try {
                room.checkAllAnswered();
              } catch (err) {
                console.error("[sala] erro ao verificar respostas:", err);
              }
            }, DISCONNECT_GRACE_MS).unref();
          }
        }
        socket.leave(`room:${room.code}`);
        socket.data.code = null;
        socket.data.role = null;
      }
      function requireHost(socket, code) {
        const room = manager.get(code || socket.data.code);
        if (!room) throw new GameError("Esta sala n\xE3o existe mais.");
        if (!socket.data.userId || socket.data.userId !== room.hostUserId) {
          throw new GameError("Apenas quem criou a partida pode control\xE1-la.");
        }
        return room;
      }
      function requirePlayer(socket) {
        const room = manager.get(socket.data.code);
        if (!room || socket.data.role !== "player") throw new GameError("Voc\xEA n\xE3o est\xE1 em uma partida.");
        const p = room.players.get(socket.data.playerId);
        if (!p || p.kicked) throw new GameError("Voc\xEA n\xE3o est\xE1 mais nesta partida.");
        return { room, player: p };
      }
      io.use((socket, next) => {
        socket.data.userId = userIdFromCookieHeader(socket.handshake.headers.cookie) || verifyToken(socket.handshake.auth && typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : null);
        next();
      });
      io.on("connection", (socket) => {
        let bucket = 40;
        const refill = setInterval(() => bucket = Math.min(40, bucket + 8), 1e3);
        function on(event, handler) {
          socket.on(event, async (payload, ack) => {
            const reply = safeAck(ack);
            if (--bucket < 0) return reply({ ok: false, error: "Calma! Muitas a\xE7\xF5es em pouco tempo." });
            try {
              const result = await handler(payload && typeof payload === "object" ? payload : {});
              reply({ ok: true, ...result || {} });
            } catch (err) {
              reply({ ok: false, error: errorMessage(err) });
            }
          });
        }
        on("host:create", async ({ gameId, config: config2 }) => {
          if (!socket.data.userId) throw new GameError("Entre na sua conta para criar uma partida.");
          if (!isUuid(gameId)) throw new GameError("Escolha um jogo v\xE1lido.");
          const game = store2.state.games[gameId];
          if (!game || game.owner_id !== socket.data.userId) throw new GameError("Jogo n\xE3o encontrado na sua biblioteca.");
          const room = manager.create({
            hostUserId: socket.data.userId,
            game,
            config: sanitizeRoomConfig(config2, game.settings),
            onChange: broadcast,
            onFinish: (r) => saveMatch(r).catch((err) => console.error("[dados] erro ao salvar partida:", err.message))
          });
          detach(socket);
          attachSocketToRoom(socket, room, "host");
          game.plays = (game.plays || 0) + 1;
          game.last_played_at = store2.now();
          store2.save();
          broadcast(room);
          return { code: room.code };
        });
        on("host:attach", async ({ code }) => {
          const room = requireHost(socket, code);
          detach(socket);
          attachSocketToRoom(socket, room, "host");
          broadcast(room);
          return { code: room.code };
        });
        on("host:action", async ({ code, action, ...data }) => {
          const room = requireHost(socket, code);
          switch (action) {
            case "start":
              room.start();
              break;
            case "reveal":
              room.reveal();
              break;
            case "next":
              room.next();
              break;
            case "end":
              room.end();
              break;
            case "restart":
              room.restart();
              break;
            case "kick": {
              const sid = room.kick(String(data.playerId || ""));
              if (sid) {
                io.to(sid).emit("room:kicked", { message: "Voc\xEA foi removido da partida pelo administrador." });
                const s = io.sockets.sockets.get(sid);
                if (s) {
                  s.leave(`room:${room.code}`);
                  s.data.code = null;
                  s.data.role = null;
                }
              }
              break;
            }
            case "answer":
              room.presenterAnswer({
                competitorId: typeof data.competitorId === "string" ? data.competitorId : null,
                value: data.value,
                judge: typeof data.judge === "boolean" ? data.judge : void 0
              });
              break;
            case "power":
              room.usePowerup(
                { type: "host" },
                { competitorId: String(data.competitorId || ""), powerup: String(data.powerup || ""), targetId: data.targetId ? String(data.targetId) : null }
              );
              break;
            case "pick":
              room.pickPowerup(
                { type: "host" },
                { competitorId: String(data.competitorId || ""), choice: data.choice ? String(data.choice) : null }
              );
              break;
            case "teams": {
              if (room.phase !== "lobby") throw new GameError("As equipes s\xF3 podem ser alteradas antes do jogo.");
              if (room.config.playStyle !== "teams") throw new GameError("Esta partida n\xE3o usa equipes.");
              const teams = sanitizeTeams(data.teams, Array.isArray(data.teams) ? data.teams.length : void 0);
              room.teams = teams;
              room.config.teams = teams;
              for (const p of room.players.values()) {
                if (p.teamId && !teams.some((t) => t.id === p.teamId)) p.teamId = room.smallestTeam().id;
              }
              room.changed();
              break;
            }
            case "close": {
              io.to(`room:${room.code}`).emit("room:closed", { message: "O administrador encerrou a sala." });
              manager.remove(room.code);
              break;
            }
            default:
              throw new GameError("A\xE7\xE3o desconhecida.");
          }
        });
        on("display:attach", async ({ code }) => {
          const room = manager.get(code);
          if (!room) throw new GameError("Sala n\xE3o encontrada. Confira o c\xF3digo.");
          detach(socket);
          attachSocketToRoom(socket, room, "display");
          broadcast(room);
          return { code: room.code };
        });
        on("room:peek", async ({ code }) => {
          const room = manager.get(code);
          if (!room) throw new GameError("Sala n\xE3o encontrada. Confira o c\xF3digo com o professor.");
          return {
            room: {
              code: room.code,
              gameTitle: room.gameTitle,
              mode: room.config.mode,
              playStyle: room.config.playStyle,
              answerSource: room.config.answerSource,
              phase: room.phase,
              teams: room.teams.map((t) => ({ ...t, members: room.membersOf(t.id).length }))
            }
          };
        });
        on("player:join", async ({ code, name, character, color, teamId }) => {
          const room = manager.get(code);
          if (!room) throw new GameError("Sala n\xE3o encontrada. Confira o c\xF3digo com o professor.");
          const player = room.addPlayer({ name, character, color, teamId });
          detach(socket);
          attachSocketToRoom(socket, room, "player", player.id);
          room.setConnected(player.id, socket.id);
          return { code: room.code, playerId: player.id, token: player.token };
        });
        on("player:rejoin", async ({ code, token }) => {
          const room = manager.get(code);
          if (!room) throw new GameError("Esta partida n\xE3o existe mais.");
          const player = room.findPlayerByToken(token);
          if (!player) throw new GameError("N\xE3o encontramos voc\xEA nesta partida. Entre de novo.");
          if (player.socketId && player.socketId !== socket.id) {
            const old = io.sockets.sockets.get(player.socketId);
            if (old) {
              old.emit("room:kicked", { message: "Voc\xEA entrou em outra aba ou dispositivo." });
              old.data.code = null;
              old.data.role = null;
              old.leave(`room:${room.code}`);
            }
          }
          detach(socket);
          attachSocketToRoom(socket, room, "player", player.id);
          room.setConnected(player.id, socket.id);
          return { code: room.code, playerId: player.id };
        });
        on("player:update", async (data) => {
          const { room, player } = requirePlayer(socket);
          room.updatePlayer(player.id, {
            character: typeof data.character === "string" ? data.character : void 0,
            color: typeof data.color === "string" ? data.color : void 0,
            teamId: typeof data.teamId === "string" ? data.teamId : void 0
          });
        });
        on("player:answer", async ({ value }) => {
          const { room, player } = requirePlayer(socket);
          if (typeof value !== "string") throw new GameError("Resposta inv\xE1lida.");
          return room.submitAnswer(player.id, value);
        });
        on("player:power", async ({ powerup, targetId }) => {
          const { room, player } = requirePlayer(socket);
          room.usePowerup(
            { type: "player", playerId: player.id },
            { powerup: String(powerup || ""), targetId: targetId ? String(targetId) : null }
          );
        });
        on("player:hack", async ({ action, value }) => {
          const { room, player } = requirePlayer(socket);
          return room.hackerAction(player.id, { action: String(action || ""), value: value == null ? null : String(value) });
        });
        on("player:password", async ({ password }) => {
          const { room, player } = requirePlayer(socket);
          room.setHackerPassword(player.id, String(password || ""));
        });
        on("player:pick", async ({ choice }) => {
          const { room, player } = requirePlayer(socket);
          room.pickPowerup({ type: "player", playerId: player.id }, { choice: choice ? String(choice) : null });
        });
        on("player:leave", async () => {
          const room = manager.get(socket.data.code);
          if (room && socket.data.role === "player") {
            const pid = socket.data.playerId;
            detach(socket);
            room.kick(pid);
          } else detach(socket);
        });
        socket.on("disconnect", () => {
          clearInterval(refill);
          detach(socket);
        });
      });
      return manager;
    }
    module2.exports = { setup, manager };
  }
});

// server/lib/rateLimit.js
var require_rateLimit = __commonJS({
  "server/lib/rateLimit.js"(exports2, module2) {
    "use strict";
    function rateLimit({ windowMs, max, message }) {
      const hits = /* @__PURE__ */ new Map();
      setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      }, windowMs).unref();
      return (req, res, next) => {
        const key = `${req.ip}|${req.baseUrl}${req.path}`;
        const now = Date.now();
        let entry = hits.get(key);
        if (!entry || entry.reset < now) {
          entry = { count: 0, reset: now + windowMs };
          hits.set(key, entry);
        }
        entry.count++;
        if (entry.count > max) {
          res.setHeader("Retry-After", Math.ceil((entry.reset - now) / 1e3));
          return res.status(429).json({ error: message || "Muitas tentativas. Aguarde um pouco e tente de novo." });
        }
        next();
      };
    }
    module2.exports = rateLimit;
  }
});

// server/routes/auth.js
var require_auth2 = __commonJS({
  "server/routes/auth.js"(exports2, module2) {
    "use strict";
    var express2 = require("express");
    var bcrypt = require("bcryptjs");
    var store2 = require_store();
    var { uuid, HttpError } = require_util();
    var { validateEmail, validatePassword, validateName, sanitizeAvatar } = require_validate();
    var { setSessionCookie, clearSessionCookie, publicUser, requireAuth } = require_auth();
    var { copyDemoGamesTo, systemUserId } = require_seed();
    var rateLimit = require_rateLimit();
    var router = express2.Router();
    var authLimiter = rateLimit({ windowMs: 15 * 60 * 1e3, max: 30 });
    function findByEmail(email) {
      return Object.values(store2.state.users).find((u) => u.email === email) || null;
    }
    router.post("/register", authLimiter, async (req, res) => {
      const name = validateName(req.body.name);
      const email = validateEmail(req.body.email);
      const password = validatePassword(req.body.password);
      if (findByEmail(email)) throw new HttpError(409, "J\xE1 existe uma conta com este e-mail. Tente entrar.");
      const guest = req.user && req.user.isGuest ? store2.state.users[req.user.id] : null;
      if (guest) {
        Object.assign(guest, {
          name,
          email,
          password_hash: await bcrypt.hash(password, 10),
          avatar: sanitizeAvatar(req.body.avatar),
          role: ["teacher", "student"].includes(req.body.role) ? req.body.role : null,
          created_at: store2.now(),
          from_guest: true
        });
        delete guest.is_guest;
        await store2.save();
        setSessionCookie(req, res, guest.id);
        return res.status(201).json({ user: publicUser(guest), keptGames: true });
      }
      const user = {
        id: uuid(),
        name,
        email,
        password_hash: await bcrypt.hash(password, 10),
        avatar: sanitizeAvatar(req.body.avatar),
        // Só para os números do painel do site; não muda nada no uso.
        role: ["teacher", "student"].includes(req.body.role) ? req.body.role : null,
        created_at: store2.now()
      };
      store2.state.users[user.id] = user;
      copyDemoGamesTo(user.id);
      await store2.save();
      setSessionCookie(req, res, user.id);
      res.status(201).json({ user: publicUser(user) });
    });
    router.post("/login", authLimiter, async (req, res) => {
      const email = String(req.body.email || "").trim().toLowerCase();
      const user = email ? findByEmail(email) : null;
      if (!user || user.password_hash === "!") {
        throw new HttpError(401, "N\xE3o encontramos uma conta com este e-mail. Confira o e-mail ou crie uma conta.");
      }
      const ok = await bcrypt.compare(String(req.body.password || ""), user.password_hash);
      if (!ok) throw new HttpError(401, "Senha incorreta.");
      if (req.user && req.user.isGuest && req.user.id !== user.id) await deleteGuest(req.user.id);
      setSessionCookie(req, res, user.id);
      res.json({ user: publicUser(user) });
    });
    var guestLimiter = rateLimit({ windowMs: 60 * 60 * 1e3, max: 20, message: "Muitas entradas no modo an\xF4nimo. Tente de novo mais tarde." });
    router.post("/guest", guestLimiter, async (req, res) => {
      const user = {
        id: uuid(),
        name: "An\xF4nimo",
        email: null,
        password_hash: "!",
        avatar: sanitizeAvatar(req.body.avatar),
        is_guest: true,
        created_at: store2.now(),
        last_seen_at: store2.now()
      };
      store2.state.users[user.id] = user;
      copyDemoGamesTo(user.id);
      store2.state.meta.guest_sessions = (store2.state.meta.guest_sessions || 0) + 1;
      await store2.save();
      setSessionCookie(req, res, user.id);
      res.status(201).json({ user: publicUser(user) });
    });
    router.post("/logout", async (req, res) => {
      if (req.user && req.user.isGuest) await deleteGuest(req.user.id);
      clearSessionCookie(res);
      res.json({ ok: true });
    });
    router.get("/me", (req, res) => {
      res.json({ user: req.user || null });
    });
    router.patch("/me", requireAuth, async (req, res) => {
      const user = store2.state.users[req.user.id];
      if (!("name" in req.body) && !("avatar" in req.body)) throw new HttpError(400, "Nada para atualizar.");
      if ("name" in req.body) user.name = validateName(req.body.name);
      if ("avatar" in req.body) user.avatar = sanitizeAvatar(req.body.avatar);
      await store2.save();
      res.json({ user: publicUser(user) });
    });
    router.post("/password", requireAuth, authLimiter, async (req, res) => {
      if (req.user.isGuest) throw new HttpError(400, "No modo an\xF4nimo n\xE3o existe senha. Crie uma conta para guardar seus jogos.");
      const user = store2.state.users[req.user.id];
      const ok = await bcrypt.compare(String(req.body.currentPassword || ""), user.password_hash);
      if (!ok) throw new HttpError(400, "A senha atual est\xE1 incorreta.");
      user.password_hash = await bcrypt.hash(validatePassword(req.body.newPassword), 10);
      await store2.save();
      res.json({ ok: true });
    });
    function imagesOf(game) {
      const ids = [];
      if (game.cover_image) ids.push(game.cover_image);
      for (const q of game.questions || []) if (q.image) ids.push(q.image);
      return ids;
    }
    async function deleteGuest(userId) {
      const u = store2.state.users[userId];
      if (!u || !u.is_guest) return 0;
      const keeper = systemUserId();
      for (const g of Object.values(store2.state.games)) {
        if (g.owner_id === userId && g.is_public) {
          g.owner_id = keeper;
          g.author_label = "An\xF4nimo";
        }
      }
      return deleteUserData(userId);
    }
    async function cleanGuests(maxIdleMs = 12 * 60 * 60 * 1e3) {
      let n = 0;
      for (const u of Object.values(store2.state.users)) {
        if (!u.is_guest) continue;
        const last = Date.parse(u.last_seen_at || u.created_at);
        if (Date.now() - last > maxIdleMs) {
          await deleteGuest(u.id);
          n++;
        }
      }
      if (n) console.log(`[dados] ${n} sess\xE3o(\xF5es) do modo an\xF4nimo apagada(s).`);
      return n;
    }
    async function deleteUserData(userId) {
      const mine = Object.values(store2.state.games).filter((g) => g.owner_id === userId);
      const myImages = new Set(mine.flatMap(imagesOf));
      for (const g of mine) delete store2.state.games[g.id];
      for (const g of Object.values(store2.state.games)) for (const id of imagesOf(g)) myImages.delete(id);
      for (const m of Object.values(store2.state.matches)) if (m.owner_id === userId) delete store2.state.matches[m.id];
      delete store2.state.users[userId];
      await store2.save();
      for (const id of myImages) await store2.deleteImage(id).catch(() => {
      });
      return mine.length;
    }
    router.delete("/me", requireAuth, authLimiter, async (req, res) => {
      if (req.user.isGuest) {
        await deleteGuest(req.user.id);
        clearSessionCookie(res);
        return res.json({ ok: true });
      }
      const user = store2.state.users[req.user.id];
      const ok = await bcrypt.compare(String(req.body && req.body.password || ""), user.password_hash);
      if (!ok) throw new HttpError(400, "Senha incorreta. A conta n\xE3o foi exclu\xEDda.");
      const deletedGames = await deleteUserData(user.id);
      clearSessionCookie(res);
      res.json({ ok: true, deletedGames });
    });
    router.get("/stats", requireAuth, (req, res) => {
      const games = Object.values(store2.state.games).filter((g) => g.owner_id === req.user.id);
      const matches = Object.values(store2.state.matches).filter((m) => m.owner_id === req.user.id).sort((a, b) => a.started_at < b.started_at ? 1 : -1);
      res.json({
        games: games.length,
        questions: games.reduce((n, g) => n + (g.questions || []).length, 0),
        plays: games.reduce((n, g) => n + (g.plays || 0), 0),
        matches: Math.max(matches.length, (store2.state.users[req.user.id] || {}).match_count || 0),
        recentMatches: matches.slice(0, 12).map((r) => ({
          id: r.id,
          gameId: r.game_id,
          gameTitle: r.game_title,
          mode: r.mode,
          topScore: r.results && r.results[0] ? r.results[0].score : null,
          participants: (r.results || []).length,
          startedAt: r.started_at,
          finishedAt: r.finished_at
        }))
      });
    });
    module2.exports = router;
    module2.exports.deleteUserData = deleteUserData;
    module2.exports.deleteGuest = deleteGuest;
    module2.exports.cleanGuests = cleanGuests;
  }
});

// server/routes/community.js
var require_community = __commonJS({
  "server/routes/community.js"(exports2, module2) {
    "use strict";
    var express2 = require("express");
    var store2 = require_store();
    var { isUuid, HttpError, cleanText, normalizeAnswer } = require_util();
    var { isQuestionReady } = require_validate();
    var { requireAuth } = require_auth();
    var { SUBJECTS } = require_constants();
    var { insertGame, copyFields } = require_games();
    var rateLimit = require_rateLimit();
    var router = express2.Router();
    var MIN_READY = 3;
    var HIDE_AFTER_REPORTS = 3;
    function isListed(g) {
      return (g.is_public || g.is_demo) && (g.reports || []).length < HIDE_AFTER_REPORTS;
    }
    function ownerName(g) {
      if (g.is_demo) return "Equipe Baamboofree";
      if (g.author_label) return g.author_label;
      const u = store2.state.users[g.owner_id];
      return u ? u.name.split(" ")[0] : "Professor(a)";
    }
    function card(g, req) {
      const questions = g.questions || [];
      return {
        id: g.id,
        title: g.title,
        description: g.description,
        subject: g.subject,
        coverImage: g.cover_image,
        readyCount: questions.filter(isQuestionReady).length,
        copies: g.copies || 0,
        ownerName: ownerName(g),
        isDemo: !!g.is_demo,
        isMine: !!req.user && req.user.id === g.owner_id,
        publishedAt: g.published_at || g.created_at
      };
    }
    function listedGame(id) {
      const g = isUuid(id) ? store2.state.games[id] : null;
      if (!g || !isListed(g)) throw new HttpError(404, "Este jogo n\xE3o est\xE1 na comunidade.");
      return g;
    }
    router.get("/community", (req, res) => {
      const search = normalizeAnswer(cleanText(req.query.search, 100));
      const subject = SUBJECTS.includes(req.query.subject) ? req.query.subject : null;
      const sort = req.query.sort === "popular" ? "popular" : "recent";
      let list = Object.values(store2.state.games).filter(isListed);
      if (search) list = list.filter((g) => normalizeAnswer(`${g.title} ${g.description}`).includes(search));
      if (subject) list = list.filter((g) => g.subject === subject);
      list.sort(
        (a, b) => sort === "popular" ? (b.copies || 0) - (a.copies || 0) || ((b.published_at || "") > (a.published_at || "") ? 1 : -1) : (b.is_demo ? 0 : 1) - (a.is_demo ? 0 : 1) || ((b.published_at || b.created_at) > (a.published_at || a.created_at) ? 1 : -1)
      );
      res.json({ games: list.slice(0, 120).map((g) => card(g, req)), total: list.length });
    });
    router.get("/community/:id", (req, res) => {
      const g = listedGame(req.params.id);
      const questions = (g.questions || []).filter(isQuestionReady).map((q) => ({ ...q, ready: true }));
      res.json({ game: { ...card(g, req), questions } });
    });
    router.post("/community/:id/copy", requireAuth, async (req, res) => {
      const src = listedGame(req.params.id);
      const row = insertGame(req.user.id, copyFields(src));
      if (src.owner_id !== req.user.id) src.copies = (src.copies || 0) + 1;
      await store2.save();
      res.status(201).json({ game: { id: row.id, title: row.title } });
    });
    router.post(
      "/community/:id/report",
      requireAuth,
      rateLimit({ windowMs: 60 * 60 * 1e3, max: 20 }),
      async (req, res) => {
        const g = listedGame(req.params.id);
        if (g.owner_id === req.user.id) throw new HttpError(400, "Voc\xEA n\xE3o pode denunciar o seu pr\xF3prio jogo.");
        g.reports = g.reports || [];
        if (!g.reports.includes(req.user.id)) g.reports.push(req.user.id);
        await store2.save();
        res.json({ ok: true });
      }
    );
    router.post("/games/:id/publish", requireAuth, async (req, res) => {
      const g = isUuid(req.params.id) ? store2.state.games[req.params.id] : null;
      if (!g || g.owner_id !== req.user.id) throw new HttpError(404, "Jogo n\xE3o encontrado.");
      const publish = !(req.body && req.body.public === false);
      if (publish) {
        const ready = (g.questions || []).filter(isQuestionReady).length;
        if (ready < MIN_READY) throw new HttpError(400, `Para publicar, o jogo precisa ter pelo menos ${MIN_READY} perguntas prontas.`);
        if (!g.title || /^novo jogo$/i.test(g.title.trim())) throw new HttpError(400, "D\xEA um t\xEDtulo ao jogo antes de publicar.");
        if (!g.is_public) g.published_at = store2.now();
      }
      g.is_public = publish;
      await store2.save();
      res.json({ isPublic: g.is_public });
    });
    var soloLimit = rateLimit({ windowMs: 60 * 60 * 1e3, max: 120, message: "Muitas partidas seguidas." });
    router.post("/solo/played", soloLimit, async (req, res) => {
      const src = String(req.body.src || "");
      const id = String(req.body.id || "");
      let g = null;
      if (src === "link" && /^[A-Za-z0-9]{8}$/.test(id)) g = Object.values(store2.state.games).find((x) => x.share_code === id && x.is_shared);
      else if (isUuid(id)) g = store2.state.games[id];
      if (g) g.solo_plays = (g.solo_plays || 0) + 1;
      store2.state.meta.solo_plays = (store2.state.meta.solo_plays || 0) + 1;
      await store2.save();
      res.json({ ok: true });
    });
    module2.exports = router;
  }
});

// server/routes/ai.js
var require_ai = __commonJS({
  "server/routes/ai.js"(exports2, module2) {
    "use strict";
    var express2 = require("express");
    var store2 = require_store();
    var { HttpError, cleanText, clampInt, uuid } = require_util();
    var { sanitizeQuestion, isQuestionReady } = require_validate();
    var { requireAuth } = require_auth();
    var { LIMITS } = require_constants();
    var router = express2.Router();
    var BASE = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
    var KNOWN_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.8-flash"];
    var discovered = { at: 0, list: [] };
    function versionOf(name) {
      const m = name.match(/gemini-(\d+(?:\.\d+)?)/);
      return m ? parseFloat(m[1]) : 0;
    }
    async function discoverModels() {
      if (Date.now() - discovered.at < 6 * 60 * 60 * 1e3) return discovered.list;
      try {
        const res = await fetch(`${BASE}/models?pageSize=1000`, {
          headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
          signal: AbortSignal.timeout(1e4)
        });
        if (res.ok) {
          const data = await res.json();
          const names = (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => String(m.name || "").replace(/^models\//, "")).filter((n) => /^gemini-.*flash/.test(n) && !/(preview|exp|tts|live|image|audio|embedding|thinking|8b)/.test(n));
          const score = (n) => (n.includes("lite") ? 1e3 : 0) + versionOf(n) * 10 + (n.includes("latest") ? -1 : 0);
          discovered = { at: Date.now(), list: names.sort((a, b) => score(b) - score(a)).slice(0, 4) };
        } else {
          discovered = { at: Date.now() - 5 * 60 * 60 * 1e3, list: [] };
        }
      } catch (_) {
      }
      return discovered.list;
    }
    async function modelList() {
      const found = await discoverModels();
      return [...new Set([process.env.GEMINI_MODEL, ...found, ...KNOWN_MODELS].filter(Boolean))];
    }
    var PER_HOUR = 15;
    var usage = /* @__PURE__ */ new Map();
    var LEVELS = {
      infantil: "educa\xE7\xE3o infantil (4 a 5 anos), frases bem curtas",
      fund1: "ensino fundamental anos iniciais (1\xBA ao 5\xBA ano)",
      fund2: "ensino fundamental anos finais (6\xBA ao 9\xBA ano)",
      medio: "ensino m\xE9dio",
      geral: "p\xFAblico geral"
    };
    function aiEnabled() {
      return !!process.env.GEMINI_API_KEY;
    }
    function checkQuota(userId) {
      const now = Date.now();
      const list = (usage.get(userId) || []).filter((t) => now - t < 60 * 60 * 1e3);
      if (list.length >= PER_HOUR) {
        throw new HttpError(429, `Voc\xEA j\xE1 criou ${PER_HOUR} levas de perguntas nesta hora. Espere um pouco e tente de novo.`);
      }
      list.push(now);
      usage.set(userId, list);
    }
    function buildPrompt({ topic, count, type, level, source, text }) {
      const kind = type === "open" ? "todas de resposta aberta (a resposta tem de 1 a 3 palavras)" : type === "multiple" ? "todas de m\xFAltipla escolha com 4 alternativas" : "a maioria de m\xFAltipla escolha com 4 alternativas e algumas de resposta aberta (resposta de 1 a 3 palavras)";
      const mc = '{"type":"multiple","text":"Quanto \xE9 7 x 8?","options":["54","56","64","49"],"correct":1}';
      const op = '{"type":"open","text":"Qual \xE9 a capital do Brasil?","options":[],"correct":-1,"answers":["Bras\xEDlia","Brasilia"]}';
      const example = type === "open" ? '{"questions":[{"text":"Qual \xE9 a capital do Brasil?","answers":["Bras\xEDlia","Brasilia"]}]}' : type === "multiple" ? '{"questions":[{"text":"Quanto \xE9 7 x 8?","options":["54","56","64","49"],"correct":1}]}' : `{"questions":[${mc.replace(/}$/, ',"answers":[]}')},${op}]}`;
      let base;
      if (source === "text") {
        base = `Crie as perguntas usando SOMENTE as informa\xE7\xF5es do texto abaixo (trecho de livro ou material da aula).${topic ? `
Foco pedido pelo professor: ${topic}` : ""}
N\xE3o use fatos que n\xE3o estejam no texto.

TEXTO (entre <<< e >>>):
<<<
${text}
>>>`;
      } else if (source === "image") {
        base = `Crie as perguntas usando SOMENTE o conte\xFAdo das fotos enviadas (p\xE1ginas de livro did\xE1tico ou material da aula).${topic ? `
Foco pedido pelo professor: ${topic}` : ""}
N\xE3o use fatos que n\xE3o estejam nas fotos. Se n\xE3o der para ler nada nas fotos, responda {"questions":[]}.`;
      } else {
        base = `Tema: ${topic}`;
      }
      return `Voc\xEA cria perguntas de quiz para professores brasileiros usarem com a turma.

${base}

Quantidade: exatamente ${count} perguntas
Tipo: ${kind}
N\xEDvel: ${LEVELS[level] || LEVELS.geral}

Regras:
- Escreva em portugu\xEAs do Brasil, com linguagem adequada ao n\xEDvel.
- S\xF3 fatos corretos e confer\xEDveis; nada de opini\xE3o ou pegadinha.
- Cada pergunta tem uma \xFAnica resposta certa, sem ambiguidade.
- Alternativas curtas (at\xE9 60 caracteres), plaus\xEDveis e diferentes entre si; a certa em posi\xE7\xE3o variada.
- Em resposta aberta, liste a resposta e outras formas aceitas (sin\xF4nimos, com e sem artigo, siglas).
- Perguntas curtas (at\xE9 200 caracteres), sem repetir perguntas.
- Conte\xFAdo apropriado para crian\xE7as e adolescentes.

Responda SOMENTE com JSON neste formato:
${example}
"correct" \xE9 OBRIGAT\xD3RIO em toda pergunta de m\xFAltipla escolha: \xE9 o n\xFAmero (0, 1, 2 ou 3) da posi\xE7\xE3o da alternativa certa dentro de "options".`;
    }
    function buildSchema(type) {
      const props = {
        type: { type: "STRING", enum: ["multiple", "open"] },
        text: { type: "STRING" },
        options: { type: "ARRAY", items: { type: "STRING" } },
        correct: { type: "INTEGER" },
        answers: { type: "ARRAY", items: { type: "STRING" } }
      };
      let fields;
      if (type === "multiple") fields = ["text", "options", "correct"];
      else if (type === "open") fields = ["text", "answers"];
      else fields = ["type", "text", "options", "correct", "answers"];
      const properties = Object.fromEntries(fields.map((f) => [f, props[f]]));
      return {
        type: "OBJECT",
        properties: {
          questions: {
            type: "ARRAY",
            items: { type: "OBJECT", properties, required: fields, propertyOrdering: fields }
          }
        },
        required: ["questions"]
      };
    }
    async function askModel(model, prompt, { schema, fast }, timeoutMs, extraParts = []) {
      const generationConfig = { responseMimeType: "application/json", temperature: 0.7 };
      if (schema) generationConfig.responseSchema = schema;
      if (fast) generationConfig.thinkingConfig = versionOf(model) >= 3 ? { thinkingLevel: "minimal" } : { thinkingBudget: 0 };
      const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, ...extraParts] }], generationConfig }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const body = await res.text();
      return { status: res.status, body };
    }
    function keyProblem(status, body) {
      if (status === 401 || status === 403) return true;
      return status === 400 && /API_KEY_INVALID|API key not valid|API key expired/i.test(body);
    }
    var KeyError = class extends Error {
    };
    async function tryModel(model, prompt, schema, deadline, extraParts) {
      const variants = [
        { schema, fast: true },
        { schema, fast: false },
        { schema: null, fast: false }
      ];
      let lastErr = "";
      for (const v of variants) {
        const left = deadline - Date.now();
        if (left < 3e3) return { err: lastErr || `${model}: demorou demais` };
        let r;
        try {
          r = await askModel(model, prompt, v, Math.min(6e4, left), extraParts);
        } catch (err) {
          return { err: `${model}: ${err.name === "TimeoutError" ? "demorou demais" : err.message}` };
        }
        if (keyProblem(r.status, r.body)) {
          console.error("[ia] chave recusada:", r.status, r.body.slice(0, 300));
          throw new KeyError();
        }
        if (r.status === 429) return { err: `${model}: limite (429)` };
        if (r.status === 400) {
          lastErr = `${model}: 400 ${r.body.slice(0, 150)}`;
          continue;
        }
        if (r.status < 200 || r.status >= 300) return { err: `${model}: ${r.status} ${r.body.slice(0, 200)}` };
        let data;
        try {
          data = JSON.parse(r.body);
        } catch (_) {
          return { err: `${model}: resposta ileg\xEDvel` };
        }
        const cand = (data.candidates || [])[0] || {};
        const text = ((cand.content || {}).parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
        if (!text.trim()) return { err: `${model}: resposta vazia (${cand.finishReason || (data.promptFeedback || {}).blockReason || "sem motivo"})` };
        return { text, model, finish: cand.finishReason || "" };
      }
      return { err: lastErr };
    }
    async function callGemini(prompt, schema, extraParts = []) {
      const deadline = Date.now() + 9e4;
      const models = await modelList();
      const errors = [];
      const keyFail = () => new HttpError(503, "A chave da IA foi recusada pelo Google. Confira a vari\xE1vel GEMINI_API_KEY no Render (sem espa\xE7os antes ou depois).");
      const first = models.slice(0, 2);
      try {
        const winner = await new Promise((resolve) => {
          let pending = first.length;
          if (!pending) resolve(null);
          for (const m of first) {
            tryModel(m, prompt, schema, deadline, extraParts).then(
              (r) => {
                if (r.text) return resolve(r);
                errors.push(r.err);
                if (--pending === 0) resolve(null);
              },
              (err) => {
                if (err instanceof KeyError) return resolve({ keyError: true });
                errors.push(`${m}: ${err.message}`);
                if (--pending === 0) resolve(null);
              }
            );
          }
        });
        if (winner && winner.keyError) throw keyFail();
        if (winner) return winner;
        for (const m of models.slice(2)) {
          if (Date.now() > deadline - 3e3) break;
          const r = await tryModel(m, prompt, schema, deadline, extraParts);
          if (r.text) return r;
          errors.push(r.err);
        }
      } catch (err) {
        if (err instanceof KeyError) throw keyFail();
        throw err;
      }
      console.error("[ia] nenhum modelo respondeu:", errors.join(" | "));
      if (errors.length && errors.every((e) => /limite \(429\)/.test(e))) throw new HttpError(429, "A IA atingiu o limite gr\xE1tis por agora. Tente de novo daqui a alguns minutos.");
      const short = errors.map((e) => String(e).replace(/\s+/g, " ").slice(0, 60)).join(" | ");
      throw new HttpError(502, `A IA n\xE3o respondeu agora. Tente de novo em instantes. (${short.slice(0, 300)})`);
    }
    function readJson(text) {
      const clean = String(text).replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
      try {
        return JSON.parse(clean);
      } catch (_) {
        const a = clean.indexOf("{");
        const b = clean.lastIndexOf("}");
        if (a >= 0 && b > a) {
          try {
            return JSON.parse(clean.slice(a, b + 1));
          } catch (_2) {
          }
        }
        const found = [];
        const re = /\{[^{}]*"text"[^{}]*\}/g;
        let m;
        while (m = re.exec(clean)) {
          try {
            found.push(JSON.parse(m[0]));
          } catch (_2) {
          }
        }
        return found.length ? { questions: found } : null;
      }
    }
    var optText = (o) => o && typeof o === "object" ? o.text ?? o.option ?? o.label ?? o.texto ?? "" : o ?? "";
    var pick = (o, keys) => keys.map((k) => o[k]).find((v) => v !== void 0 && v !== null);
    function correctIndex(raw, texts) {
      const c = pick(raw, ["correct", "correctIndex", "correct_index", "correct_option", "correctAnswer", "answer", "correta", "resposta"]);
      const norm = (t) => String(t).trim().toLowerCase();
      if (typeof c === "string") {
        const byText = texts.findIndex((t) => norm(t) === norm(c));
        if (byText >= 0) return byText;
      }
      if (typeof c === "number" || /^\s*\d+\s*$/.test(String(c ?? ""))) {
        const n = Number(c);
        if (n >= 0 && n < texts.length) return n;
        if (n === texts.length) return n - 1;
        return -1;
      }
      if (typeof c === "string") {
        const letter = c.trim().match(/^([A-Fa-f])[).:]?$/);
        if (letter) return letter[1].toUpperCase().charCodeAt(0) - 65;
      }
      return -1;
    }
    function parseQuestions(text, count, points) {
      const json = readJson(text);
      let list = [];
      if (Array.isArray(json)) list = json;
      else if (json && typeof json === "object") list = pick(json, ["questions", "perguntas", "quiz", "items"]) || Object.values(json).find(Array.isArray) || [];
      if (!Array.isArray(list)) list = [];
      const out = [];
      for (const raw of list) {
        if (out.length >= count) break;
        if (!raw || typeof raw !== "object") continue;
        const id = uuid().slice(0, 8);
        const qText = String(pick(raw, ["text", "question", "pergunta", "enunciado"]) ?? "");
        const rawOptions = pick(raw, ["options", "choices", "alternatives", "alternativas", "opcoes"]);
        let q;
        if (raw.type === "open" || !Array.isArray(rawOptions) && Array.isArray(raw.answers)) {
          const answers = (Array.isArray(raw.answers) ? raw.answers : [raw.answers]).map((a) => String(optText(a)));
          q = { id, type: "open", text: qText, answers, points };
        } else {
          const texts = (Array.isArray(rawOptions) ? rawOptions : []).slice(0, LIMITS.optionsMax).map((t) => String(optText(t)));
          const options = texts.map((t, i) => ({ id: `${id}${i}`, text: t }));
          const idx = correctIndex(raw, texts);
          q = { id, type: "multiple", text: qText, options, correct: idx >= 0 && options[idx] ? options[idx].id : null, points };
        }
        const clean = sanitizeQuestion(q, { points });
        if (isQuestionReady(clean)) out.push(clean);
      }
      return out;
    }
    router.get("/ai/status", (_req, res) => res.json({ enabled: aiEnabled() }));
    router.post("/ai/questions", requireAuth, async (req, res) => {
      if (!aiEnabled()) throw new HttpError(503, "A IA ainda n\xE3o foi configurada neste site. Falta a vari\xE1vel GEMINI_API_KEY no Render.");
      const source = ["text", "image"].includes(req.body.source) ? req.body.source : "topic";
      const topic = cleanText(req.body.topic, 200);
      let text = "";
      const parts = [];
      if (source === "topic" && topic.length < 3) throw new HttpError(400, "Escreva o tema das perguntas. Ex.: capitais do Brasil.");
      if (source === "text") {
        text = String(req.body.text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, 15e3);
        if (text.length < 80) throw new HttpError(400, "Cole um texto maior (pelo menos algumas frases) para a IA criar as perguntas.");
      }
      if (source === "image") {
        const images = Array.isArray(req.body.images) ? req.body.images.slice(0, 3) : [];
        for (const img of images) {
          const mime = String(img && img.mime || "");
          const data = String(img && img.data || "");
          if (!/^image\/(jpeg|png|webp)$/.test(mime) || !/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 6 * 1024 * 1024) {
            throw new HttpError(400, "Foto inv\xE1lida. Envie fotos em JPG ou PNG.");
          }
          parts.push({ inlineData: { mimeType: mime, data } });
        }
        if (!parts.length) throw new HttpError(400, "Escolha pelo menos uma foto da p\xE1gina do livro.");
      }
      const count = clampInt(req.body.count, 1, 20, 10);
      const type = ["multiple", "open", "mix"].includes(req.body.type) ? req.body.type : "multiple";
      const level = LEVELS[req.body.level] ? req.body.level : "geral";
      const points = clampInt(req.body.points, 0, 1e3, 10);
      checkQuota(req.user.isGuest ? `ip:${req.ip}` : req.user.id);
      const prompt = buildPrompt({ topic, count, type, level, source, text });
      let questions = [];
      let detail = "";
      const started = Date.now();
      for (let attempt = 0; attempt < 2 && !questions.length; attempt++) {
        if (attempt > 0 && Date.now() - started > 25e3) break;
        const { text: answer, model, finish } = await callGemini(prompt, buildSchema(type), parts);
        try {
          questions = parseQuestions(answer, count, points);
        } catch (err) {
          console.error("[ia] n\xE3o consegui ler a resposta:", err.message);
        }
        if (!questions.length) {
          console.error(`[ia] ${model} (${finish}) respondeu sem perguntas v\xE1lidas:`, String(answer).slice(0, 1500));
          detail = `${model}, ${finish || "?"}: ${String(answer).replace(/\s+/g, " ").slice(0, 140)}`;
          if (source === "image" && /"questions"\s*:\s*\[\s*\]/.test(String(answer))) break;
        }
      }
      if (!questions.length && source === "image") {
        throw new HttpError(422, "A IA n\xE3o conseguiu ler as fotos. Tire a foto mais de perto, reta e com boa luz, ou cole o texto.");
      }
      if (!questions.length) {
        throw new HttpError(502, `A IA n\xE3o conseguiu criar perguntas sobre esse tema agora. Tente de novo ou escreva o tema de outro jeito. (detalhe: ${detail})`);
      }
      store2.state.meta.ai_uses = (store2.state.meta.ai_uses || 0) + 1;
      store2.save();
      res.json({ questions });
    });
    module2.exports = router;
    module2.exports.parseQuestions = parseQuestions;
    module2.exports.callGemini = callGemini;
    module2.exports.aiEnabled = aiEnabled;
  }
});

// server/routes/images.js
var require_images = __commonJS({
  "server/routes/images.js"(exports2, module2) {
    "use strict";
    var express2 = require("express");
    var store2 = require_store();
    var config2 = require_config();
    var { uuid, isUuid, HttpError } = require_util();
    var { requireAuth } = require_auth();
    var rateLimit = require_rateLimit();
    var router = express2.Router();
    function sniffMime(buf) {
      if (buf.length < 12) return null;
      if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return "image/jpeg";
      if (buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71) return "image/png";
      if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
      if (buf.toString("ascii", 0, 4) === "GIF8") return "image/gif";
      return null;
    }
    router.post(
      "/images",
      requireAuth,
      rateLimit({ windowMs: 10 * 60 * 1e3, max: 120, message: "Muitos envios de imagem. Aguarde alguns minutos." }),
      express2.raw({ type: ["image/*", "application/octet-stream"], limit: config2.maxImageBytes }),
      async (req, res) => {
        const buf = req.body;
        if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, "Envie um arquivo de imagem.");
        const mime = sniffMime(buf);
        if (!mime) throw new HttpError(415, "Formato n\xE3o suportado. Use JPG, PNG, WEBP ou GIF.");
        const id = uuid();
        await store2.saveImage(id, mime, buf);
        res.status(201).json({ id, url: `/api/images/${id}` });
      }
    );
    router.get("/images/:id", async (req, res) => {
      if (!isUuid(req.params.id)) throw new HttpError(404, "Imagem n\xE3o encontrada.");
      const row = await store2.getImage(req.params.id);
      if (!row) throw new HttpError(404, "Imagem n\xE3o encontrada.");
      const data = row.data;
      res.setHeader("Content-Type", row.mime);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(data);
    });
    module2.exports = router;
  }
});

// server/routes/admin.js
var require_admin = __commonJS({
  "server/routes/admin.js"(exports2, module2) {
    "use strict";
    var express2 = require("express");
    var store2 = require_store();
    var { HttpError, isUuid } = require_util();
    var { requireAdmin } = require_auth();
    var { SYSTEM_EMAIL } = require_seed();
    var router = express2.Router();
    var DAY = 24 * 60 * 60 * 1e3;
    function systemId() {
      const u = Object.values(store2.state.users).find((x) => x.email === SYSTEM_EMAIL);
      return u ? u.id : null;
    }
    function demoTitles() {
      return new Set(
        Object.values(store2.state.games).filter((g) => g.is_demo).map((g) => g.title)
      );
    }
    function isOwnWork(g, demos) {
      return !g.is_demo && !g.from_demo && !demos.has(g.title);
    }
    function dayKey(iso) {
      return String(iso || "").slice(0, 10);
    }
    function lastDays(n) {
      const out = [];
      for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.now() - i * DAY).toISOString().slice(0, 10));
      return out;
    }
    router.get("/admin/overview", requireAdmin, async (_req, res) => {
      const sys = systemId();
      const demos = demoTitles();
      const users = Object.values(store2.state.users).filter((u) => u.id !== sys && !u.is_guest);
      const guestsNow = Object.values(store2.state.users).filter((u) => u.is_guest).length;
      const games = Object.values(store2.state.games);
      const own = games.filter((g) => isOwnWork(g, demos));
      const byOwner = {};
      for (const g of own) byOwner[g.owner_id] = (byOwner[g.owner_id] || 0) + 1;
      const matchCount = (u) => Math.max(
        u.match_count || 0,
        Object.values(store2.state.matches).filter((m) => m.owner_id === u.id).length
      );
      const days = lastDays(14);
      const roleOf = (u) => u.role === "teacher" || u.role === "student" ? u.role : "unknown";
      const signups = Object.fromEntries(days.map((d) => [d, { teacher: 0, student: 0, unknown: 0 }]));
      for (const u of users) if (signups[dayKey(u.created_at)]) signups[dayKey(u.created_at)][roleOf(u)]++;
      const roles = { teacher: 0, student: 0, unknown: 0 };
      for (const u of users) roles[roleOf(u)]++;
      const matchesByDay = Object.fromEntries(days.map((d) => [d, 0]));
      for (const m of Object.values(store2.state.matches)) if (matchesByDay[dayKey(m.finished_at)] !== void 0) matchesByDay[dayKey(m.finished_at)]++;
      const week = Date.now() - 7 * DAY;
      const reported = games.filter((g) => (g.reports || []).length).map((g) => ({
        id: g.id,
        title: g.title,
        owner: (store2.state.users[g.owner_id] || {}).name || "?",
        reports: g.reports.length,
        isPublic: !!g.is_public
      }));
      const topGames = games.filter((g) => !g.is_demo).map((g) => ({ id: g.id, title: g.title, owner: (store2.state.users[g.owner_id] || {}).name || "?", plays: g.plays || 0, solo: g.solo_plays || 0, copies: g.copies || 0, isPublic: !!g.is_public })).filter((g) => g.plays + g.solo + g.copies > 0).sort((a, b) => b.plays + b.solo + b.copies - (a.plays + a.solo + a.copies)).slice(0, 10);
      let storage = null;
      try {
        storage = await store2.storageStats();
      } catch (_) {
        storage = null;
      }
      res.json({
        totals: {
          users: users.length,
          teachers: roles.teacher,
          students: roles.student,
          unknownRole: roles.unknown,
          activeWeek: users.filter((u) => u.last_seen_at && Date.parse(u.last_seen_at) > week).length,
          newWeek: users.filter((u) => Date.parse(u.created_at) > week).length,
          games: own.length,
          questions: own.reduce((n, g) => n + (g.questions || []).length, 0),
          matches: users.reduce((n, u) => n + matchCount(u), 0),
          soloPlays: store2.state.meta.solo_plays || 0,
          community: games.filter((g) => g.is_public).length,
          aiUses: store2.state.meta.ai_uses || 0,
          guestsNow,
          guestSessions: store2.state.meta.guest_sessions || 0
        },
        signups: days.map((d) => ({ day: d, ...signups[d], count: signups[d].teacher + signups[d].student + signups[d].unknown })),
        matchesByDay: days.map((d) => ({ day: d, count: matchesByDay[d] })),
        users: users.sort((a, b) => a.created_at < b.created_at ? 1 : -1).map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: roleOf(u),
          createdAt: u.created_at,
          lastSeenAt: u.last_seen_at || null,
          games: byOwner[u.id] || 0,
          matches: matchCount(u)
        })),
        topGames,
        reported,
        storage
      });
    });
    router.post("/admin/games/:id/moderate", requireAdmin, async (req, res) => {
      const g = isUuid(req.params.id) ? store2.state.games[req.params.id] : null;
      if (!g) throw new HttpError(404, "Jogo n\xE3o encontrado.");
      if (req.body.action === "hide") g.is_public = false;
      g.reports = [];
      await store2.save();
      res.json({ ok: true });
    });
    router.delete("/admin/users/:id", requireAdmin, async (req, res) => {
      const id = req.params.id;
      if (!isUuid(id) || !store2.state.users[id]) throw new HttpError(404, "Conta n\xE3o encontrada.");
      if (id === req.user.id) throw new HttpError(400, "Voc\xEA n\xE3o pode excluir a sua pr\xF3pria conta por aqui.");
      if (id === systemId()) throw new HttpError(400, "Esta \xE9 a conta dos jogos de demonstra\xE7\xE3o.");
      const { deleteUserData } = require_auth2();
      const deletedGames = await deleteUserData(id);
      res.json({ ok: true, deletedGames });
    });
    module2.exports = router;
  }
});

// server/papo-push.js
var require_papo_push = __commonJS({
  "server/papo-push.js"(exports2, module2) {
    "use strict";
    var crypto = require("crypto");
    var express2 = require("express");
    var PROJECT = process.env.PAPO_FIREBASE_PROJECT || "papo-flash";
    var SUBJECT = process.env.PAPO_PUSH_CONTACT || "https://papo-flash.onrender.com";
    var FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
    var b64u = (buf) => Buffer.from(buf).toString("base64url");
    var unb64u = (s) => Buffer.from(String(s || ""), "base64url");
    var vapid = null;
    function loadVapid() {
      if (vapid !== null) return vapid;
      let d = (process.env.PAPO_VAPID_PRIVATE || "").trim();
      if (!d) {
        try {
          const store2 = require_store();
          store2.state.meta = store2.state.meta || {};
          if (!store2.state.meta.papoVapid) {
            const ecdh = crypto.createECDH("prime256v1");
            ecdh.generateKeys();
            store2.state.meta.papoVapid = b64u(ecdh.getPrivateKey());
            store2.save();
          }
          d = store2.state.meta.papoVapid;
        } catch (err) {
          console.error("[papo] n\xE3o deu para criar a chave dos avisos:", err.message);
          return vapid = false;
        }
      }
      try {
        const ecdh = crypto.createECDH("prime256v1");
        ecdh.setPrivateKey(unb64u(d));
        const pub = ecdh.getPublicKey();
        const key = crypto.createPrivateKey({
          key: { kty: "EC", crv: "P-256", d, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
          format: "jwk"
        });
        vapid = { key, publicKey: b64u(pub) };
      } catch (err) {
        console.error("[papo] PAPO_VAPID_PRIVATE inv\xE1lida:", err.message);
        vapid = false;
      }
      return vapid;
    }
    var jwtCache = /* @__PURE__ */ new Map();
    function vapidHeader(endpoint) {
      const v = loadVapid();
      const aud = new URL(endpoint).origin;
      const now = Math.floor(Date.now() / 1e3);
      let c = jwtCache.get(aud);
      if (!c || c.exp - now < 3600) {
        const exp = now + 12 * 3600;
        const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
        const body = b64u(JSON.stringify({ aud, exp, sub: SUBJECT }));
        const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key: v.key, dsaEncoding: "ieee-p1363" });
        c = { token: `${head}.${body}.${b64u(sig)}`, exp };
        jwtCache.set(aud, c);
      }
      return `vapid t=${c.token}, k=${v.publicKey}`;
    }
    var hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
    function encrypt(p256dh, authSecret, plaintext, _testSalt, _testKey) {
      const uaPublic = unb64u(p256dh);
      const auth = unb64u(authSecret);
      if (uaPublic.length !== 65 || auth.length < 16) throw new Error("inscri\xE7\xE3o inv\xE1lida");
      const ecdh = crypto.createECDH("prime256v1");
      if (_testKey) ecdh.setPrivateKey(_testKey);
      else ecdh.generateKeys();
      const asPublic = ecdh.getPublicKey();
      const secret = ecdh.computeSecret(uaPublic);
      const prkKey = hmac(auth, secret);
      const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
      const salt = _testSalt || crypto.randomBytes(16);
      const prk = hmac(salt, ikm);
      const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0")).subarray(0, 16);
      const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0")).subarray(0, 12);
      const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
      const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
      const rs = Buffer.alloc(4);
      rs.writeUInt32BE(4096);
      return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
    }
    async function sendPush(sub, payload, { ttl = 3600, urgency = "high", topic } = {}) {
      const body = encrypt(sub.p256dh, sub.auth, JSON.stringify(payload));
      const headers = {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: String(ttl),
        Urgency: urgency,
        Authorization: vapidHeader(sub.endpoint)
      };
      if (topic) headers.Topic = topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
      const r = await fetch(sub.endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(8e3) });
      return r.status;
    }
    function decodeVal(v) {
      if (!v || typeof v !== "object") return null;
      if ("stringValue" in v) return v.stringValue;
      if ("integerValue" in v) return Number(v.integerValue);
      if ("doubleValue" in v) return v.doubleValue;
      if ("booleanValue" in v) return v.booleanValue;
      if ("timestampValue" in v) return Date.parse(v.timestampValue);
      if ("nullValue" in v) return null;
      if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeVal);
      if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
      return null;
    }
    function decodeFields(f) {
      const o = {};
      for (const [k, v] of Object.entries(f || {})) o[k] = decodeVal(v);
      return o;
    }
    async function fsGet(path2, token) {
      const r = await fetch(`${FS}/${path2}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8e3) });
      if (r.status === 404) return null;
      if (!r.ok) {
        const e = new Error(r.status === 401 || r.status === 403 ? "Sem permiss\xE3o." : "Firestore indispon\xEDvel.");
        e.status = r.status === 401 ? 401 : r.status === 403 ? 403 : 502;
        throw e;
      }
      return decodeFields((await r.json()).fields);
    }
    async function fsBatchGet(paths, token) {
      if (!paths.length) return {};
      const prefix = `projects/${PROJECT}/databases/(default)/documents/`;
      const r = await fetch(`${FS}:batchGet`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ documents: paths.map((p) => prefix + p) }),
        signal: AbortSignal.timeout(8e3)
      });
      if (!r.ok) return {};
      const out = {};
      for (const item of await r.json()) {
        if (item.found) out[item.found.name.slice(prefix.length)] = decodeFields(item.found.fields);
      }
      return out;
    }
    function uidFromToken(token) {
      try {
        const p = JSON.parse(unb64u(token.split(".")[1]).toString());
        return p.user_id || p.sub || null;
      } catch (_) {
        return null;
      }
    }
    var hits = /* @__PURE__ */ new Map();
    function tooMany(uid) {
      const now = Date.now();
      const list = (hits.get(uid) || []).filter((t) => now - t < 6e4);
      list.push(now);
      hits.set(uid, list);
      if (hits.size > 5e3) hits.clear();
      return list.length > 40;
    }
    var clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
    function router() {
      const r = express2.Router();
      r.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
          res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
          res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
          res.setHeader("Access-Control-Max-Age", "86400");
        }
        if (req.method === "OPTIONS") return res.status(204).end();
        next();
      });
      r.use(express2.json({ limit: "16kb" }));
      r.get("/status", (_req, res) => res.json({ ok: true, push: !!loadVapid(), publicKey: loadVapid() ? loadVapid().publicKey : null }));
      r.post("/notify", async (req, res) => {
        try {
          if (!loadVapid()) return res.status(503).json({ error: "Avisos ainda n\xE3o configurados no servidor." });
          const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
          const me = uidFromToken(token);
          if (!token || !me) return res.status(401).json({ error: "Entre na sua conta." });
          if (tooMany(me)) return res.status(429).json({ error: "Muitos avisos seguidos." });
          const { cid, kind } = req.body || {};
          if (!/^[A-Za-z0-9_-]{1,200}$/.test(String(cid || "")) || !["msg", "call"].includes(kind)) return res.status(400).json({ error: "Dados inv\xE1lidos." });
          const conv = await fsGet(`conversations/${cid}`, token);
          if (!conv || !Array.isArray(conv.members) || !conv.members.includes(me)) return res.status(403).json({ error: "Sem permiss\xE3o." });
          if (kind === "call" && !(conv.call && conv.call.by === me)) return res.status(409).json({ error: "Nenhuma chamada sua acontecendo." });
          const others = conv.members.filter((u) => u !== me).slice(0, 100);
          const docs = await fsBatchGet([`users/${me}`, ...others.map((u) => `pushSubs/${u}`), ...others.map((u) => `users/${u}`)], token);
          const mentions = new Set((Array.isArray(req.body.mentions) ? req.body.mentions : []).filter((u) => others.includes(u)));
          const myName = clean((docs[`users/${me}`] || {}).name, 60) || "Algu\xE9m";
          const isDm = conv.type === "dm";
          const place = isDm ? "" : clean(`${conv.emoji || ""} ${conv.name || "Espa\xE7o"}`, 70);
          const text = clean(req.body.text, 140);
          const callKind = conv.call && conv.call.kind === "video" ? "v\xEDdeo" : "voz";
          const payload = kind === "call" ? {
            kind: "call",
            cid,
            callId: conv.call.id,
            title: isDm ? `\u{1F4DE} ${myName} est\xE1 te ligando` : `\u{1F4DE} Chamada em ${place}`,
            body: isDm ? `Chamada de ${callKind} \xB7 toque para atender` : `${myName} come\xE7ou uma chamada de ${callKind} \xB7 toque para entrar`,
            tag: `call-${conv.call.id}`
          } : {
            kind: "msg",
            cid,
            title: isDm ? myName : place,
            body: isDm ? text || "Mensagem nova" : `${myName}: ${text || "mensagem nova"}`,
            tag: `msg-${cid}`
          };
          let sent = 0;
          const jobs = [];
          for (const u of others) {
            const prof = docs[`users/${u}`] || {};
            if (isDm && (prof.blocked || []).includes(me)) continue;
            const mentioned = kind === "msg" && mentions.has(u);
            if ((prof.muted || []).includes(cid) && !mentioned) continue;
            const pl = mentioned ? { ...payload, title: `\u{1F4AC} ${myName} mencionou voc\xEA${place ? ` em ${place}` : ""}`, body: text || "mensagem nova", tag: `men-${cid}` } : payload;
            const subs = ((docs[`pushSubs/${u}`] || {}).subs || []).filter((s) => s && /^https:\/\//.test(s.endpoint || "")).slice(-10);
            for (const s of subs) {
              jobs.push(
                sendPush(s, pl, kind === "call" ? { ttl: 60, urgency: "high", topic: payload.tag } : { ttl: 86400, urgency: "normal", topic: payload.tag }).then((st) => {
                  if (st >= 200 && st < 300) sent++;
                }).catch(() => {
                })
              );
            }
          }
          await Promise.all(jobs);
          res.json({ ok: true, sent });
        } catch (err) {
          res.status(err.status || 500).json({ error: err.status ? err.message : "N\xE3o foi poss\xEDvel avisar." });
        }
      });
      const aiHits = /* @__PURE__ */ new Map();
      let aiDay = { day: "", n: 0 };
      r.post("/ai", express2.json({ limit: "24kb" }), async (req, res) => {
        try {
          const ai = require_ai();
          if (!ai.aiEnabled()) return res.status(503).json({ error: "A IA ainda n\xE3o foi ligada no servidor." });
          const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
          const me = uidFromToken(token);
          if (!token || !me) return res.status(401).json({ error: "Entre na sua conta." });
          const { cid } = req.body || {};
          const question = clean(req.body && req.body.question, 500);
          if (!/^[A-Za-z0-9_-]{1,200}$/.test(String(cid || "")) || question.length < 2) return res.status(400).json({ error: "Escreva a pergunta depois de @IA." });
          const now = Date.now();
          const mine = (aiHits.get(me) || []).filter((t) => now - t < 36e5);
          if (mine.length >= 12) return res.status(429).json({ error: "Voc\xEA j\xE1 fez 12 perguntas para a IA nesta hora. Espere um pouco." });
          const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
          if (aiDay.day !== today) aiDay = { day: today, n: 0 };
          if (aiDay.n >= 300) return res.status(429).json({ error: "A IA j\xE1 respondeu muito hoje. Volte amanh\xE3!" });
          const conv = await fsGet(`conversations/${cid}`, token);
          if (!conv || !Array.isArray(conv.members) || !conv.members.includes(me)) return res.status(403).json({ error: "Sem permiss\xE3o." });
          mine.push(now);
          aiHits.set(me, mine);
          aiDay.n++;
          const ctx = (Array.isArray(req.body.context) ? req.body.context : []).slice(-8).map((m) => `${clean(m && m.name, 30) || "Algu\xE9m"}: ${clean(m && m.text, 300)}`).join("\n");
          const prompt = `Voc\xEA \xE9 a assistente do Papo Flash, um chat usado por estudantes e professores brasileiros.
Responda em portugu\xEAs do Brasil, de forma clara, simp\xE1tica e curta (no m\xE1ximo 120 palavras), com linguagem adequada para estudantes.
N\xE3o invente fatos; se n\xE3o souber, diga que n\xE3o sabe. N\xE3o ajude com nada perigoso, ofensivo ou impr\xF3prio para a escola.
Use *negrito* para destacar (com um asterisco de cada lado) e listas simples com "\u2022 " quando ajudar.
${ctx ? `
\xDAltimas mensagens da conversa (s\xF3 para contexto):
${ctx}
` : ""}
Pergunta: ${question}`;
          const schema = { type: "OBJECT", properties: { answer: { type: "STRING" } }, required: ["answer"] };
          const out = await ai.callGemini(prompt, schema);
          let answer = "";
          try {
            answer = JSON.parse(out.text).answer;
          } catch (_) {
            answer = out.text;
          }
          answer = String(answer || "").trim().slice(0, 3500);
          if (!answer) return res.status(502).json({ error: "A IA n\xE3o conseguiu responder. Tente perguntar de outro jeito." });
          res.json({ answer });
        } catch (err) {
          const status = err.status || err.statusCode || 500;
          res.status(status).json({ error: status < 500 || err.expose || err.statusCode ? err.message : "A IA n\xE3o conseguiu responder agora." });
        }
      });
      return r;
    }
    module2.exports = { router, encrypt, loadVapid, _reset: () => vapid = null };
  }
});

// server/index.js
var fs = require("fs");
var path = require("path");
var http = require("http");
var express = require("express");
var compression = require("compression");
var cookieParser = require("cookie-parser");
var { Server } = require("socket.io");
var config = require_config();
var store = require_store();
var { seedDemos } = require_seed();
var { loadUser } = require_auth();
var sockets = require_sockets();
async function createApp() {
  await store.init();
  await seedDemos();
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(compression());
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });
  app.use(cookieParser());
  const api = express.Router();
  const jsonSmall = express.json({ limit: "1mb" });
  const jsonBig = express.json({ limit: "12mb" });
  api.use((req, res, next) => (req.path === "/ai/questions" ? jsonBig : jsonSmall)(req, res, next));
  api.use(loadUser);
  api.get("/health", (_req, res) => res.json({ ok: true, database: store.info(), rooms: sockets.manager.rooms.size }));
  api.get("/storage", (_req, res) => res.json(store.info()));
  api.use("/auth", require_auth2());
  api.use(require_games());
  api.use(require_community());
  api.use(require_ai());
  api.use(require_images());
  api.use(require_admin());
  api.use((_req, res) => res.status(404).json({ error: "Rota n\xE3o encontrada." }));
  api.use((err, _req, res, _next) => {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Arquivo grande demais (m\xE1ximo de 2 MB)." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Dados inv\xE1lidos." });
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error("[api] erro:", err);
    res.status(status).json({ error: status >= 500 && !err.expose ? "Erro interno do servidor. Tente de novo." : err.message });
  });
  app.use("/api", api);
  app.use("/papo", require_papo_push().router());
  const adsClient = /^ca-pub-\d{10,20}$/.test(process.env.ADSENSE_CLIENT || "") ? process.env.ADSENSE_CLIENT : null;
  app.get("/ads.txt", (_req, res) => {
    if (!adsClient) return res.status(404).type("text/plain").send("");
    res.type("text/plain").send(`google.com, ${adsClient.replace("ca-", "")}, DIRECT, f08c47fec0942fa0
`);
  });
  const indexFile = path.join(config.publicDir, "index.html");
  let indexHtml = null;
  function renderIndex() {
    if (indexHtml === null) {
      let page = fs.readFileSync(indexFile, "utf8");
      if (adsClient) {
        page = page.replace(
          "</head>",
          `    <meta name="google-adsense-account" content="${adsClient}" />
    <script>window.ADSENSE_CLIENT = "${adsClient}";</script>
  </head>`
        );
      }
      indexHtml = page;
    }
    return indexHtml;
  }
  if (!fs.existsSync(indexFile)) {
    console.warn(`[server] Arquivos do site n\xE3o encontrados em ${config.publicDir}.`);
  }
  app.use(
    express.static(config.publicDir, {
      index: false,
      setHeaders(res, file) {
        if (/\.(js|css)$/.test(file) && /-[A-Z0-9]{8}\./i.test(path.basename(file))) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      }
    })
  );
  app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
    if (!fs.existsSync(indexFile)) {
      return res.status(503).send("Arquivos do site n\xE3o encontrados (pasta public).");
    }
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(renderIndex());
  });
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: config.corsOrigin ? { origin: config.corsOrigin.split(","), credentials: true } : void 0,
    pingInterval: 2e4,
    pingTimeout: 25e3
  });
  sockets.setup(io);
  return { app, server, io };
}
async function cleanOrphanImages() {
  const used = /* @__PURE__ */ new Set();
  for (const g of Object.values(store.state.games)) {
    if (g.cover_image) used.add(g.cover_image);
    for (const q of g.questions || []) if (q.image) used.add(q.image);
  }
  let removed = 0;
  for (const id of await store.listOldImages(24 * 60 * 60 * 1e3)) {
    if (used.has(id)) continue;
    await store.deleteImage(id);
    removed++;
  }
  if (removed) console.log(`[dados] ${removed} imagem(ns) sem uso apagada(s).`);
  return removed;
}
async function main() {
  const { server } = await createApp();
  let cleaned = false;
  for (const m of Object.values(store.state.matches)) {
    for (const r of m.results || []) {
      if ("name" in r) {
        delete r.name;
        cleaned = true;
      }
    }
  }
  if (cleaned) await store.save();
  const runCleanup = () => cleanOrphanImages().catch((err) => console.error("[dados] limpeza de imagens:", err.message));
  setTimeout(runCleanup, 5 * 60 * 1e3).unref();
  const { cleanGuests } = require_auth2();
  setInterval(() => cleanGuests().catch((err) => console.error("[dados] limpeza do modo an\xF4nimo:", err.message)), 30 * 60 * 1e3).unref();
  setInterval(runCleanup, 24 * 60 * 60 * 1e3).unref();
  server.listen(config.port, config.host, () => {
    console.log(`[server] Baamboofree rodando em http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`);
  });
  const shutdown = async (signal) => {
    console.log(`[server] ${signal} recebido, encerrando...`);
    server.close();
    await store.close().catch(() => {
    });
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
if (require.main === module) {
  main().catch((err) => {
    console.error("[server] Falha ao iniciar:", err);
    process.exit(1);
  });
}
module.exports = { createApp, cleanOrphanImages };
