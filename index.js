import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import session from 'express-session';
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { startKickWatcher } from './watchers/kick.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- storage ---------------- */
const DATA_DIR = path.join(__dirname, 'data');
const CFG_PATH = path.join(DATA_DIR, 'config.json');
const PANEL1_PATH = path.join(DATA_DIR, 'panel1.json');
const PANEL2_PATH = path.join(DATA_DIR, 'panel2.json');
const STREAMERS_PATH = path.join(DATA_DIR, 'streamers.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const readJson  = (p, f) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return f; } };
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));

// defaults
if (!fs.existsSync(CFG_PATH))     writeJson(CFG_PATH, { supportCategoryId:'', allowedRoleIds:[], kick:{ message:'', allowedVoiceIds:[] } });
if (!fs.existsSync(PANEL1_PATH))  writeJson(PANEL1_PATH, { mode:'button', title:'Organizer Support', body:'Have an inquiry?', buttonLabel:'Create ticket', options:[], branding:null, buttonForm:[] });
if (!fs.existsSync(PANEL2_PATH))  writeJson(PANEL2_PATH, { mode:'button', title:'Organizer Support', body:'Have an inquiry?', buttonLabel:'Create ticket', options:[], branding:null, buttonForm:[] });
if (!fs.existsSync(STREAMERS_PATH)) writeJson(STREAMERS_PATH, []);

/* ---------------- express ---------------- */
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.engine('ejs', (await import('ejs')).default.__express);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- sessions ---------------- */
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace_me',
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax' }
}));
const requireAuth = (req,res,next)=> req.session?.authed ? next() : res.redirect('/login');

/* ---------------- pages ---------------- */
app.get('/', (_req,res)=> res.send('✅ Bot running. <a href="/dashboard">Dashboard</a>'));
app.get('/health', (_req,res)=> res.status(200).send('OK'));

/* ---------------- auth ---------------- */
app.get('/login', (req,res)=>{
  if (req.session?.authed) return res.redirect('/dashboard');
  res.render('login', { title:'Login', error:null });
});
app.post('/login', (req,res)=>{
  const pass = req.body?.password || '';
  if (pass && process.env.ADMIN_PASSWORD && pass === process.env.ADMIN_PASSWORD) {
    req.session.authed = true;
    return res.redirect('/dashboard');
  }
  res.status(401).render('login', { title:'Login', error:'Wrong password.' });
});
app.get('/logout', (req,res)=> req.session.destroy(()=> res.redirect('/login')) );

/* ---------------- discord ---------------- */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel]
});

client.commands = new Collection();

// /commands klasöründen slash komutları yükle (varsa)
const commandsDir = path.join(__dirname, 'commands');
if (fs.existsSync(commandsDir)) {
  for (const f of fs.readdirSync(commandsDir).filter(x=>x.endsWith('.js'))) {
    const mod = await import(pathToFileURL(path.join(commandsDir, f)).href);
    if (mod?.data?.name) client.commands.set(mod.data.name, mod);
  }
}

client.on('ready', ()=> console.log(`Logged in as ${client.user.tag}`));

client.on('interactionCreate', async (interaction)=>{
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction, client);
  } catch (err) {
    console.error(err);
    const msg = '⚠️ Something went wrong.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: msg, flags: 64 }).catch(()=>{});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(()=>{});
    }
  }
});

/* ---- guild verisi (dashboard için) ---- */
async function fetchGuildData() {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.channels.fetch();
    const roles = (await guild.roles.fetch()).map(r=>({ id:r.id, name:r.name, color:r.color }));
    const categories = guild.channels.cache.filter(c=>c.type===4).map(c=>({ id:c.id, name:c.name })); // category
    const voices = guild.channels.cache.filter(c=>c.type===2).map(c=>({ id:c.id, name:c.name }));     // voice
    const text   = guild.channels.cache.filter(c=>c.type===0).map(c=>({ id:c.id, name:'#'+c.name })); // text
    return { roles, categories, voices, text };
  } catch {
    return { roles:[], categories:[], voices:[], text:[] };
  }
}

/* ---------------- dashboard ---------------- */
app.get('/dashboard', requireAuth, async (_req,res)=>{
  const cfg = readJson(CFG_PATH, {});
  const panel1 = readJson(PANEL1_PATH, {});
  const panel2 = readJson(PANEL2_PATH, {});
  const streamers = readJson(STREAMERS_PATH, []);
  const guildData = await fetchGuildData();

  res.render('dashboard', {
    title:'Dashboard',
    ready: client?.isReady?.() || false,
    botTag: client?.user?.tag || null,
    guildId: process.env.GUILD_ID || 'n/a',
    cfg, panel1, panel2, streamers, guildData
  });
});

app.post('/dashboard/save-config', requireAuth, (req,res)=>{
  const cfg = readJson(CFG_PATH,{});
  const allowedRoleIds = String(req.body.allowedRoleIds||'').split(',').map(s=>s.trim()).filter(Boolean);
  writeJson(CFG_PATH, { 
    ...cfg, 
    supportCategoryId: (req.body.supportCategoryId||'').trim(),
    allowedRoleIds,
    kick: cfg.kick || { message:'', allowedVoiceIds:[] }
  });
  res.redirect('/dashboard');
});

app.post('/dashboard/save-panel', requireAuth, (req,res)=>{
  const which = String(req.body.which||'1')==='2' ? 2 : 1;
  const target = which===2 ? PANEL2_PATH : PANEL1_PATH;
  const parse = (j,f)=>{ try { return JSON.parse(j); } catch { return f; } };
  const next = {
    mode: req.body.mode==='dropdown' ? 'dropdown' : 'button',
    title: (req.body.title||'').trim(),
    body: (req.body.body||'').trim(),
    buttonLabel: (req.body.buttonLabel||'Create ticket').trim(),
    branding: (req.body.brand_label || req.body.brand_url) ? { label:req.body.brand_label||'', url:req.body.brand_url||'' } : null,
    buttonForm: parse(req.body.buttonFormJson||'[]', []),
    options:    parse(req.body.optionsJson||'[]', [])
  };
  writeJson(target, next);
  res.redirect('/dashboard');
});

app.post('/dashboard/kick/save', requireAuth, (req,res)=>{
  const cfg = readJson(CFG_PATH,{});
  const allowedVoiceIds = String(req.body.voice_allowed_ids||'').split(',').map(s=>s.trim()).filter(Boolean);
  cfg.kick = { message:(req.body.kick_message||'').trim(), allowedVoiceIds };
  writeJson(CFG_PATH, cfg);

  const count = Number(req.body.kick_count||0);
  const rows = [];
  for (let i=0;i<count;i++){
    const login = (req.body[`kick_${i}_login`]||'').trim();
    const discordUserId = (req.body[`kick_${i}_uid`]||'').trim();
    const announceChannelId = (req.body[`kick_${i}_chan`]||'').trim();
    const enabled = !!req.body[`kick_${i}_enabled`];
    if (login && discordUserId) rows.push({ platform:'kick', login, discordUserId, announceChannelId, enabled });
  }
  writeJson(STREAMERS_PATH, rows);

  res.redirect('/dashboard');
});

/* ---------------- start ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Web up on :${PORT}`));

client.login(process.env.DISCORD_TOKEN).then(()=>{
  startKickWatcher(client);
});
// --- keep existing imports and client setup at top ---

/* tiny JSON stores */
const DATA_DIR = path.join(__dirname, 'data');
const CFG_PATH  = path.join(DATA_DIR, 'config.json');             // tickets (existing)
const KICK_PATH = path.join(DATA_DIR, 'kick.json');               // kick alert (new)
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive:true });
if (!fs.existsSync(CFG_PATH))  fs.writeFileSync(CFG_PATH, JSON.stringify({ supportCategoryId:'', allowedRoleIds:[] }, null, 2));
if (!fs.existsSync(KICK_PATH)) fs.writeFileSync(KICK_PATH, JSON.stringify({
  allowedVoiceIds: [],             // array of voice channel ids
  fallbackChannelId: "",           // optional text channel id
  globalMessage: "",               // DM body template
  streamers: []                    // [{ discordId, kickUrl }]
}, null, 2));

const readJson = (p)=> JSON.parse(fs.readFileSync(p,'utf8'));
const writeJson = (p,obj)=> fs.writeFileSync(p, JSON.stringify(obj, null, 2));

/* Express base (keep your existing) */
app.set('view engine','ejs');
app.set('views', path.join(__dirname,'views'));
app.engine('ejs',(await import('ejs')).default.__express);
app.use(express.urlencoded({ extended:true }));
app.use(express.static(path.join(__dirname,'public')));

/* auth guard (keep yours) */
const requireAuth = (req,res,next)=> req.session?.authed ? next() : res.redirect('/login');

/* helper to map guild structure for selects */
async function collectGuildData() {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const full  = await guild.fetch();
  const channels = await guild.channels.fetch();

  const categories = [];
  const textChannels = [];
  const voiceChannels = [];

  channels.forEach(ch => {
    if (!ch) return;
    if (ch.type === 4) categories.push({ id: ch.id, name: ch.name });                 // category
    if (ch.type === 0) textChannels.push({ id: ch.id, name: `#${ch.name}` });         // text
    if (ch.type === 2) voiceChannels.push({ id: ch.id, name: ch.name });              // voice
  });

  const roles = (await guild.roles.fetch()).map(r => ({ id: r.id, name: r.name, color: r.color }));

  return { categories, textChannels, voiceChannels, roles };
}

/* ------------ Routes ------------- */

// Landing with two cards
app.get('/dashboard', requireAuth, async (_req,res) => {
  res.render('dashboard_home', {
    layout:'layout',
    title:'Dashboard',
    loggedIn:true,
    ready: client?.isReady?.() || false,
    botTag: client?.user?.tag || null,
    guildId: process.env.GUILD_ID || 'n/a'
  });
});

// Ticket editor (panel=1 or 2 via ?which=1)
app.get('/dashboard/tickets', requireAuth, async (req,res) => {
  const which = String(req.query.which || '1');
  const cfg   = readJson(CFG_PATH);
  const panelPath = path.join(DATA_DIR, `panel${which}.json`);
  const panel = fs.existsSync(panelPath) ? readJson(panelPath) : { mode:'button', title:'Organizer Support', body:'Have an inquiry? Use the control below to open a ticket. A private channel will be created and our team will assist you.' };

  const guildData = await collectGuildData();

  res.render('dashboard_tickets', {
    layout:'layout',
    title:`Panel ${which}`,
    loggedIn:true,
    which, cfg, panel, guildData
  });
});

// Save ticket config (category + roles)
app.post('/dashboard/save-config', requireAuth, (req,res) => {
  const cfg = readJson(CFG_PATH);
  const allowed = Array.isArray(req.body.allowedRoleIds) ? req.body.allowedRoleIds
                : req.body.allowedRoleIds ? [req.body.allowedRoleIds] : [];
  cfg.supportCategoryId = (req.body.supportCategoryId || '').trim();
  cfg.allowedRoleIds = allowed.map(String);
  writeJson(CFG_PATH, cfg);
  res.redirect('/dashboard/tickets?which='+String(req.body.which||'1'));
});

// Save ticket panel
app.post('/dashboard/save-panel', requireAuth, (req,res) => {
  const which = String(req.body.which || '1');
  const target = path.join(DATA_DIR, `panel${which}.json`);
  const panel = {
    mode: (req.body.mode === 'dropdown') ? 'dropdown' : 'button',
    title: (req.body.title||'').trim(),
    body: (req.body.body||'').trim(),
    buttonLabel: (req.body.buttonLabel||'Create ticket').trim(),
    branding: {
      label: (req.body.brand_label||'').trim(),
      url: (req.body.brand_url||'').trim()
    },
    buttonForm: [],
    options: []
  };

  try {
    if (req.body.buttonForm && req.body.buttonForm.trim()!=='') {
      const b = JSON.parse(req.body.buttonForm);
      panel.buttonForm = Array.isArray(b) ? b.slice(0,5) : [];
    }
  } catch {}
  try {
    if (req.body.options && req.body.options.trim()!=='') {
      const o = JSON.parse(req.body.options);
      panel.options = Array.isArray(o) ? o.slice(0,6) : [];
    }
  } catch {}

  writeJson(target, panel);
  res.redirect('/dashboard/tickets?which='+which);
});

// Kick editor
app.get('/dashboard/kick', requireAuth, async (_req,res) => {
  const kick = readJson(KICK_PATH);
  const guildData = await collectGuildData();
  res.render('dashboard_kick', {
    layout:'layout',
    title:'Kick Activity Alert',
    loggedIn:true,
    kick, guildData
  });
});

// Save kick settings
app.post('/dashboard/save-kick', requireAuth, (req,res) => {
  const kick = readJson(KICK_PATH);

  // multi-select allowedVoiceIds
  let allowed = req.body.allowedVoiceIds || [];
  if (!Array.isArray(allowed)) allowed = [allowed];
  kick.allowedVoiceIds = allowed.map(String).filter(Boolean);

  kick.fallbackChannelId = (req.body.fallbackChannelId || '').trim();
  kick.globalMessage    = (req.body.globalMessage || '').trim();

  const count = parseInt(req.body.count||'0',10);
  const list = [];
  for (let i=0;i<count;i++){
    const discordId = (req.body[`streamer_${i}_discordId`]||'').trim();
    const kickUrl   = (req.body[`streamer_${i}_kickUrl`]||'').trim();
    if (discordId && kickUrl) list.push({ discordId, kickUrl });
  }
  kick.streamers = list;

  writeJson(KICK_PATH, kick);
  res.redirect('/dashboard/kick');
});
