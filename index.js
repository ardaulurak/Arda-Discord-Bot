import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import session from 'express-session';
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { startKickWatcher } from './watchers/kick.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* -------------------------- storage -------------------------- */
const DATA_DIR     = path.join(__dirname, 'data');
const CFG_PATH     = path.join(DATA_DIR, 'config.json');     // ticket basic config
const PANEL1_PATH  = path.join(DATA_DIR, 'panel1.json');     // ticket panel 1
const PANEL2_PATH  = path.join(DATA_DIR, 'panel2.json');     // ticket panel 2
const KICK_PATH    = path.join(DATA_DIR, 'kick.json');       // kick alert settings

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const readJson  = (p, fallback = {}) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

/* defaults */
if (!fs.existsSync(CFG_PATH))    writeJson(CFG_PATH, { supportCategoryId: '', allowedRoleIds: [] });
if (!fs.existsSync(PANEL1_PATH)) writeJson(PANEL1_PATH, { mode:'button', title:'Organizer Support', body:'Have an inquiry? Use the control below to open a ticket. A private channel will be created and our team will assist you.', buttonLabel:'Create ticket', branding:null, buttonForm:[], options:[] });
if (!fs.existsSync(PANEL2_PATH)) writeJson(PANEL2_PATH, { mode:'button', title:'Organizer Support', body:'Have an inquiry? Use the control below to open a ticket. A private channel will be created and our team will assist you.', buttonLabel:'Create ticket', branding:null, buttonForm:[], options:[] });
if (!fs.existsSync(KICK_PATH))   writeJson(KICK_PATH, {
  allowedVoiceIds: [],          // voice channels where streamers are considered "active"
  fallbackChannelId: "",        // optional text channel to post a warning if DM fails
  globalMessage: "",            // DM template. tokens: {user} {login} {url} {title} {game}
  streamers: []                 // [{ discordId, kickUrl }]
});

/* -------------------------- express -------------------------- */
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.engine('ejs', (await import('ejs')).default.__express);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* -------------------------- sessions ------------------------- */
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace_me',
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax' }
}));
const requireAuth = (req, res, next) => req.session?.authed ? next() : res.redirect('/login');

/* -------------------------- simple pages --------------------- */
app.get('/', (_req, res) => res.send('✅ Bot running. <a href="/dashboard">Dashboard</a>'));
app.get('/health', (_req, res) => res.status(200).send('OK'));

/* -------------------------- auth ----------------------------- */
app.get('/login', (req, res) => {
  if (req.session?.authed) return res.redirect('/dashboard');
  res.render('login', { title: 'Login', error: null });
});
app.post('/login', (req, res) => {
  const pass = req.body?.password || '';
  if (pass && process.env.ADMIN_PASSWORD && pass === process.env.ADMIN_PASSWORD) {
    req.session.authed = true;
    return res.redirect('/dashboard');
  }
  res.status(401).render('login', { title: 'Login', error: 'Wrong password.' });
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

/* -------------------------- discord client ------------------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();

/* load slash commands (if present) */
const commandsDir = path.join(__dirname, 'commands');
if (fs.existsSync(commandsDir)) {
  for (const f of fs.readdirSync(commandsDir).filter(x => x.endsWith('.js'))) {
    const mod = await import(pathToFileURL(path.join(commandsDir, f)).href);
    if (mod?.data?.name) client.commands.set(mod.data.name, mod);
  }
}

client.on('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction, client);
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

/* ---------------------- guild data for UI -------------------- */
async function collectGuildData() {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.channels.fetch();

    const categories = [];
    const textChannels = [];
    const voiceChannels = [];

    guild.channels.cache.forEach(ch => {
      if (!ch) return;
      if (ch.type === 4) categories.push({ id: ch.id, name: ch.name });          // category
      if (ch.type === 0) textChannels.push({ id: ch.id, name: `#${ch.name}` });  // text
      if (ch.type === 2) voiceChannels.push({ id: ch.id, name: ch.name });       // voice
    });

    const roles = (await guild.roles.fetch()).map(r => ({ id: r.id, name: r.name, color: r.color }));
    return { categories, textChannels, voiceChannels, roles };
  } catch {
    return { categories: [], textChannels: [], voiceChannels: [], roles: [] };
  }
}

/* -------------------------- dashboard ------------------------ */
/* Landing with the two cards (Support Ticket System / Kick Activity Alert) */
app.get('/dashboard', requireAuth, async (_req, res) => {
  res.render('dashboard_home', {
    title: 'Dashboard',
    ready: client?.isReady?.() || false,
    botTag: client?.user?.tag || null,
    guildId: process.env.GUILD_ID || 'n/a'
  });
});

/* ----- Tickets editor (Panel 1 or 2) ----- */
app.get('/dashboard/tickets', requireAuth, async (req, res) => {
  const which = String(req.query.which || '1') === '2' ? '2' : '1';
  const cfg   = readJson(CFG_PATH, {});
  const panelPath = which === '2' ? PANEL2_PATH : PANEL1_PATH;
  const panel = readJson(panelPath, {});

  const guildData = await collectGuildData();

  res.render('dashboard_tickets', {
    title: `Panel ${which}`,
    which, cfg, panel, guildData
  });
});

/* Save ticket config (category + staff roles) */
app.post('/dashboard/save-config', requireAuth, (req, res) => {
  const which = String(req.body.which || '1');
  const cfg = readJson(CFG_PATH, {});
  // handle chips (comma string) or multi-select array
  let roles = req.body.allowedRoleIds;
  if (typeof roles === 'string') {
    roles = roles.split(',').map(s => s.trim()).filter(Boolean);
  } else if (!Array.isArray(roles)) {
    roles = [];
  }
  cfg.supportCategoryId = (req.body.supportCategoryId || '').trim();
  cfg.allowedRoleIds    = roles.map(String);
  writeJson(CFG_PATH, cfg);
  res.redirect('/dashboard/tickets?which=' + which);
});

/* Save ticket panel (panel 1/2) */
app.post('/dashboard/save-panel', requireAuth, (req, res) => {
  const which  = String(req.body.which || '1') === '2' ? '2' : '1';
  const target = which === '2' ? PANEL2_PATH : PANEL1_PATH;

  const parse = (s, f) => { try { return JSON.parse(s); } catch { return f; } };

  // support both new (buttonFormJson/optionsJson) and old (buttonForm/options) fields
  const buttonForm = req.body.buttonFormJson
    ? parse(req.body.buttonFormJson, [])
    : (req.body.buttonForm ? parse(req.body.buttonForm, []) : []);

  const options = req.body.optionsJson
    ? parse(req.body.optionsJson, [])
    : (req.body.options ? parse(req.body.options, []) : []);

  const panel = {
    mode: (req.body.mode === 'dropdown') ? 'dropdown' : 'button',
    title: (req.body.title || '').trim(),
    body: (req.body.body || '').trim(),
    buttonLabel: (req.body.buttonLabel || 'Create ticket').trim(),
    branding: (req.body.brand_label || req.body.brand_url)
      ? { label: (req.body.brand_label || '').trim(), url: (req.body.brand_url || '').trim() }
      : null,
    buttonForm: Array.isArray(buttonForm) ? buttonForm.slice(0, 5) : [],
    options:    Array.isArray(options)    ? options.slice(0, 6)    : []
  };

  writeJson(target, panel);
  res.redirect('/dashboard/tickets?which=' + which);
});

/* ----- Kick Activity Alert editor ----- */
app.get('/dashboard/kick', requireAuth, async (_req, res) => {
  const kick = readJson(KICK_PATH, {});
  const guildData = await collectGuildData();
  res.render('dashboard_kick', {
    title: 'Kick Activity Alert',
    kick, guildData
  });
});

app.post('/dashboard/save-kick', requireAuth, (req, res) => {
  const kick = readJson(KICK_PATH, {});

  // multi-select voice ids
  let allowed = req.body.allowedVoiceIds || [];
  if (!Array.isArray(allowed)) allowed = [allowed];
  kick.allowedVoiceIds = allowed.map(String).filter(Boolean);

  kick.fallbackChannelId = (req.body.fallbackChannelId || '').trim();
  kick.globalMessage     = (req.body.globalMessage || '').trim();

  const count = parseInt(req.body.count || '0', 10);
  const list = [];
  for (let i = 0; i < count; i++) {
    const discordId = (req.body[`streamer_${i}_discordId`] || '').trim();
    const kickUrl   = (req.body[`streamer_${i}_kickUrl`]   || '').trim();
    if (discordId && kickUrl) list.push({ discordId, kickUrl });
  }
  kick.streamers = list;

  writeJson(KICK_PATH, kick);
  res.redirect('/dashboard/kick');
});

/* -------------------------- start ---------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web up on :${PORT}`));

client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log('[Kick] watcher running every 1 minute(s)');
    startKickWatcher(client);
  })
  .catch(err => {
    console.error('Discord login failed:', err);
  });
