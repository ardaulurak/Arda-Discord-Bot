// index.js  — FULL FILE
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import session from 'express-session';
import { Client, GatewayIntentBits, Collection, Partials, PermissionFlagsBits } from 'discord.js';
import { startKickWatcher } from './watchers/kick.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ----------------- tiny JSON stores ----------------- */
const DATA_DIR = path.join(__dirname, 'data');
const CFG_PATH = path.join(DATA_DIR, 'config.json');          // { supportCategoryId, allowedRoleIds, kick:{message, allowedVoiceIds} }
const PANEL1_PATH = path.join(DATA_DIR, 'panel1.json');       // { ... }
const PANEL2_PATH = path.join(DATA_DIR, 'panel2.json');       // { ... }
const STREAMERS_PATH = path.join(DATA_DIR, 'streamers.json'); // [ { platform:'kick', login, discordUserId, announceChannelId?, enabled } ]

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };

// ensure defaults
if (!fs.existsSync(CFG_PATH)) writeJson(CFG_PATH, { supportCategoryId: '', allowedRoleIds: [], kick: { message: '', allowedVoiceIds: [] } });
if (!fs.existsSync(PANEL1_PATH)) writeJson(PANEL1_PATH, { mode: 'button', title: 'Organizer Support', body: 'Have an inquiry?', buttonLabel: 'Create ticket', options: [], branding: null, buttonForm: [] });
if (!fs.existsSync(PANEL2_PATH)) writeJson(PANEL2_PATH, { mode: 'button', title: 'Organizer Support', body: 'Have an inquiry?', buttonLabel: 'Create ticket', options: [], branding: null, buttonForm: [] });
if (!fs.existsSync(STREAMERS_PATH)) writeJson(STREAMERS_PATH, []);

/* ----------------- Express app ---------------------- */
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.engine('ejs', (await import('ejs')).default.__express);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ----------------- Sessions ------------------------- */
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace_me',
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax' }
}));
const requireAuth = (req, res, next) => { if (req.session?.authed) return next(); res.redirect('/login'); };

/* ----------------- Minimal pages -------------------- */
app.get('/', (_req, res) => {
  res.send('✅ Bot up. <a href="/dashboard">Dashboard</a>');
});
app.get('/health', (_req, res) => res.status(200).send('OK'));

/* ----------------- Auth ------------------------------ */
app.get('/login', (req, res) => {
  if (req.session?.authed) return res.redirect('/dashboard');
  res.render('login', { error: null, title: 'Login' });
});
app.post('/login', (req, res) => {
  const pass = req.body?.password || '';
  if (pass && process.env.ADMIN_PASSWORD && pass === process.env.ADMIN_PASSWORD) {
    req.session.authed = true;
    return res.redirect('/dashboard');
  }
  res.status(401).render('login', { error: 'Wrong password.', title: 'Login' });
});
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

/* ----------------- Discord client ------------------- */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel]
});
client.commands = new Collection();

/* dynamic command loader (unchanged) */
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const full = path.join(commandsPath, file);
    const mod = await import(pathToFileURL(full).href);
    if (mod?.data?.name) client.commands.set(mod.data.name, mod);
  }
}
client.on('ready', () => console.log(`Logged in as ${client.user.tag}`));
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction, client);
  } catch (err) {
    console.error(err);
    const msg = '⚠️ Something went wrong.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: msg, flags: 64 }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

/* ----------------- Dashboard data helpers ----------- */
async function fetchGuildData() {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.channels.fetch();
    const roles = (await guild.roles.fetch()).map(r => ({ id: r.id, name: r.name, color: r.color }));
    const cats = guild.channels.cache.filter(c => c.type === 4).map(c => ({ id: c.id, name: c.name })); // 4 = GUILD_CATEGORY
    const voices = guild.channels.cache.filter(c => c.type === 2).map(c => ({ id: c.id, name: c.name })); // 2 = GUILD_VOICE
    const text = guild.channels.cache.filter(c => c.type === 0).map(c => ({ id: c.id, name: `#${c.name}` })); // 0 = GUILD_TEXT
    return { roles, categories: cats, voices, text };
  } catch {
    return { roles: [], categories: [], voices: [], text: [] };
  }
}

/* ----------------- Dashboard ------------------------ */
app.get('/dashboard', requireAuth, async (_req, res) => {
  const cfg = readJson(CFG_PATH, { supportCategoryId: '', allowedRoleIds: [], kick: { message: '', allowedVoiceIds: [] } });
  const panel1 = readJson(PANEL1_PATH, {});
  const panel2 = readJson(PANEL2_PATH, {});
  const streamers = readJson(STREAMERS_PATH, []);
  const guildData = await fetchGuildData();

  res.render('dashboard', {
    title: 'Dashboard',
    ready: client?.isReady?.() || false,
    botTag: client?.user?.tag || null,
    guildId: process.env.GUILD_ID || 'n/a',
    cfg,
    panel1,
    panel2,
    streamers,
    guildData
  });
});

/* ---- Ticket config save ---- */
app.post('/dashboard/save-config', requireAuth, (req, res) => {
  const cfg = readJson(CFG_PATH, {});
  const next = {
    supportCategoryId: (req.body.supportCategoryId || '').trim(),
    allowedRoleIds: String(req.body.allowedRoleIds || '').split(',').map(s => s.trim()).filter(Boolean),
    kick: cfg.kick || { message: '', allowedVoiceIds: [] }
  };
  writeJson(CFG_PATH, { ...cfg, ...next });
  res.redirect('/dashboard');
});

/* ---- Panel save (Panel 1 or 2) ---- */
app.post('/dashboard/save-panel', requireAuth, (req, res) => {
  const which = String(req.body.which || '1') === '2' ? 2 : 1;
  const target = which === 2 ? PANEL2_PATH : PANEL1_PATH;

  function tryParse(json, fallback) {
    try { return JSON.parse(json); } catch { return fallback; }
  }

  const panel = {
    mode: req.body.mode === 'dropdown' ? 'dropdown' : 'button',
    title: (req.body.title || '').trim(),
    body: (req.body.body || '').trim(),
    buttonLabel: (req.body.buttonLabel || 'Create ticket').trim(),
    branding: (req.body.brand_label || req.body.brand_url) ? { label: req.body.brand_label || '', url: req.body.brand_url || '' } : null,
    buttonForm: tryParse(req.body.buttonFormJson || '[]', []),
    options: tryParse(req.body.optionsJson || '[]', [])
  };

  writeJson(target, panel);
  res.redirect('/dashboard');
});

/* ---- Kick section save ---- */
app.post('/dashboard/kick/save', requireAuth, (req, res) => {
  const cfg = readJson(CFG_PATH, {});
  const allowedVoiceIds = String(req.body.voice_allowed_ids || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  cfg.kick = {
    message: (req.body.kick_message || '').trim(),
    allowedVoiceIds
  };
  writeJson(CFG_PATH, cfg);

  const count = Number(req.body.kick_count || 0);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const login = (req.body[`kick_${i}_login`] || '').trim();
    const discordUserId = (req.body[`kick_${i}_uid`] || '').trim();
    const announceChannelId = (req.body[`kick_${i}_chan`] || '').trim();
    const enabled = !!req.body[`kick_${i}_enabled`];

    if (login && discordUserId) {
      rows.push({ platform: 'kick', login, discordUserId, announceChannelId, enabled });
    }
  }
  writeJson(STREAMERS_PATH, rows);

  res.redirect('/dashboard');
});

/* ----------------- Start server & bot --------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web up on :${PORT}`));

client.login(process.env.DISCORD_TOKEN).then(() => {
  // start watcher after login
  startKickWatcher(client);
});
