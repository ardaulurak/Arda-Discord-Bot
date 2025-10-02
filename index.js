// index.js
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import express from 'express';
import session from 'express-session';
import {
  Client,
  GatewayIntentBits,
  Collection,
  Partials,
} from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ----------------- tiny config store (JSON file) ----------------- */
const DATA_DIR = path.join(__dirname, 'data');
const CFG_PATH = path.join(DATA_DIR, 'config.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CFG_PATH))
  fs.writeFileSync(
    CFG_PATH,
    JSON.stringify({ supportCategoryId: '', supportRoleId: '', allowedRoleIds: [] }, null, 2)
  );

const readCfg = () => JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const writeCfg = (obj) => fs.writeFileSync(CFG_PATH, JSON.stringify(obj, null, 2));

/* ----------------- Express app & views --------------------------- */
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.engine('ejs', (await import('ejs')).default.__express);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ----------------- Sessions (password auth) ---------------------- */
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'replace_me',
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: 'lax' },
  })
);

const requireAuth = (req, res, next) => {
  if (req.session?.authed) return next();
  res.redirect('/login');
};

/* ----------------- Minimal site & health ------------------------- */
app.get('/', (_req, res) => {
  res.send(
    '✅ Discord Ticket Bot + Dashboard is running. Visit <a href="/dashboard">/dashboard</a>.'
  );
});
app.get('/health', (_req, res) => res.status(200).send('OK'));

/* ----------------- Auth routes ---------------------------------- */
app.get('/login', (req, res) => {
  if (req.session?.authed) return res.redirect('/dashboard');
  res.render('login', { layout: 'layout', error: null, title: 'Login' });
});

app.post('/login', (req, res) => {
  const pass = req.body?.password || '';
  if (pass && process.env.ADMIN_PASSWORD && pass === process.env.ADMIN_PASSWORD) {
    req.session.authed = true;
    return res.redirect('/dashboard');
  }
  return res
    .status(401)
    .render('login', { layout: 'layout', error: 'Wrong password.', title: 'Login' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ----------------- Dashboard (reads JSON panel files) ------------ */
const panelPath = (n) => path.join(__dirname, 'data', `panel${n}.json`);
const ensurePanel = (n) => {
  const p = panelPath(n);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          mode: 'button',
          title: 'Organizer Support',
          body:
            'Have an inquiry? Use the control below to open a ticket. A private channel will be created and our team will assist you.',
          buttonLabel: 'Create ticket',
          branding: { label: '', url: '' },
          buttonForm: [],
          options: [],
        },
        null,
        2
      )
    );
  }
};
ensurePanel(1);
ensurePanel(2);

const loadPanel = (n) => JSON.parse(fs.readFileSync(panelPath(n), 'utf8'));
const savePanel = (n, data) => fs.writeFileSync(panelPath(n), JSON.stringify(data, null, 2));

app.get('/dashboard', requireAuth, (_req, res) => {
  const which = _req.query.panel === '2' ? '2' : '1';
  const cfg = readCfg();

  // Gather guild roles/categories for nicer UI (optional; safe fallback)
  res.render('dashboard', {
    layout: 'layout',
    title: 'Dashboard',
    loggedIn: true,
    ready: client?.isReady?.() || false,
    botTag: client?.user?.tag || null,
    guildId: process.env.GUILD_ID || 'n/a',
    appName: 'Ticket Bot',
    which,
    cfg,
    env: {
      SUPPORT_CATEGORY_ID: process.env.SUPPORT_CATEGORY_ID,
      SUPPORT_ROLE_ID: process.env.SUPPORT_ROLE_ID,
    },
    panel: loadPanel(which),
    guildData: { roles: [], categories: [] }, // filled by client if you wired it; safe empty fallback
  });
});

app.post('/dashboard/save', requireAuth, (req, res) => {
  const current = readCfg();
  const next = {
    supportCategoryId: (req.body.supportCategoryId || '').trim(),
    allowedRoleIds: (req.body.allowedRoleIds || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
  writeCfg({ ...current, ...next });
  res.redirect(`/dashboard?panel=${req.body.which || '1'}`);
});

app.post('/dashboard/save-panel', requireAuth, (req, res) => {
  const which = req.body.which === '2' ? 2 : 1;

  const panel = loadPanel(which);
  const next = {
    mode: req.body.mode === 'dropdown' ? 'dropdown' : 'button',
    title: (req.body.title || '').trim(),
    body: (req.body.body || '').trim(),
    buttonLabel: (req.body.buttonLabel || 'Create ticket').trim(),
    branding: {
      label: (req.body.brand_label || '').trim(),
      url: (req.body.brand_url || '').trim(),
    },
    buttonForm: [],
    options: [],
  };

  // Button form (JSON string from hidden input)
  try {
    if (req.body.buttonFormJson) {
      const parsed = JSON.parse(req.body.buttonFormJson);
      if (Array.isArray(parsed)) next.buttonForm = parsed.slice(0, 5);
    }
  } catch {
    // ignore bad JSON
  }

  // Options (JSON string from hidden input)
  try {
    if (req.body.optionsJson) {
      const parsed = JSON.parse(req.body.optionsJson);
      if (Array.isArray(parsed)) next.options = parsed.slice(0, 6);
    }
  } catch {
    // ignore
  }

  savePanel(which, next);
  res.redirect(`/dashboard?panel=${which}`);
});

/* ----------------- Start web server ------------------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web up on :${PORT}`));

/* ----------------- Discord client -------------------------------- */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel],
});

client.commands = new Collection();

// Dynamic command loader
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const files = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const full = path.join(commandsPath, file);
    const mod = await import(pathToFileURL(full).href);
    if (mod?.data?.name) {
      client.commands.set(mod.data.name, mod);
      console.log(`➕ Loaded command: /${mod.data.name} (${file})`);
    } else {
      console.log(`⚠️  Skipping "${file}" — not a slash command (no export "data").`);
    }
  }
}

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

/* --------- SAFE interaction handler (prevents 40060) ------------- */
client.on('interactionCreate', async (interaction) => {
  const isCmd = interaction.isChatInputCommand();
  const isComp =
    interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit();
  if (!isCmd && !isComp) return;

  try {
    if (isCmd) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction, client); // each command must avoid double replying
      return;
    }

    // If you have centralized component handling, call it here.

  } catch (err) {
    console.error(err);
    const msg = '⚠️ Something went wrong.';
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: msg });
      } else if (interaction.replied) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch (e) {
      console.error('secondary error while replying:', e.message);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
