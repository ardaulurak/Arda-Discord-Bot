import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import session from 'express-session';
import expressLayouts from 'express-ejs-layouts';
import {
  Client, GatewayIntentBits, Collection, Partials,
  ChannelType, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  AttachmentBuilder, StringSelectMenuBuilder
} from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- data files ---------------- */
const DATA_DIR = path.join(__dirname, 'data');
const CFG_PATH = path.join(DATA_DIR, 'config.json');
const PANEL1_PATH = path.join(DATA_DIR, 'panel1.json');
const PANEL2_PATH = path.join(DATA_DIR, 'panel2.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CFG_PATH)) {
  fs.writeFileSync(CFG_PATH, JSON.stringify({
    supportCategoryId: '',
    allowedRoleIds: []
  }, null, 2));
}
function defaultPanel() {
  return {
    mode: 'button', // 'button' | 'dropdown'
    title: 'Organizer Support',
    body: 'Have an inquiry? Use the control below to open a ticket. A private channel will be created and our team will assist you.',
    buttonLabel: 'Create ticket',
    branding: { label: '', url: '' },
    // visual builder will write objects here:
    buttonForm: [], // [{id,label,placeholder,required,style:'short|paragraph',max}]
    options: [       // each: {label,description,emoji, form:[...] }
      { label: 'General Inquiry', description: 'Choose this for general questions', emoji: '💬', form: [] }
    ]
  };
}
if (!fs.existsSync(PANEL1_PATH)) fs.writeFileSync(PANEL1_PATH, JSON.stringify(defaultPanel(), null, 2));
if (!fs.existsSync(PANEL2_PATH)) fs.writeFileSync(PANEL2_PATH, JSON.stringify(defaultPanel(), null, 2));

const readCfg      = () => JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const writeCfg     = (obj) => fs.writeFileSync(CFG_PATH, JSON.stringify(obj, null, 2));
const panelPath    = (id) => (id === '2' ? PANEL2_PATH : PANEL1_PATH);
const readPanel    = (id) => JSON.parse(fs.readFileSync(panelPath(id), 'utf8'));
const writePanel   = (id, obj) => fs.writeFileSync(panelPath(id), JSON.stringify(obj, null, 2));

/* ---------------- express ---------------- */
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- session ---------------- */
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace_me',
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax' }
}));
const requireAuth = (req, res, next) => req.session?.authed ? next() : res.redirect('/login');

/* ---------------- routes ---------------- */
app.get('/', (_req, res) => res.send('✅ Ticket Bot + Dashboard running. Visit <a href="/dashboard">/dashboard</a>.'));
app.get('/health', (_req, res) => res.status(200).send('OK'));

/* ---------------- auth ---------------- */
app.get('/login', (req, res) => {
  if (req.session?.authed) return res.redirect('/dashboard');
  res.render('login', { title: 'Login', error: null, loggedIn: false, appName: 'Ticket Bot' });
});
app.post('/login', (req, res) => {
  const pass = req.body?.password || '';
  if (pass && process.env.ADMIN_PASSWORD && pass === process.env.ADMIN_PASSWORD) {
    req.session.authed = true; return res.redirect('/dashboard');
  }
  res.status(401).render('login', { title: 'Login', error: 'Wrong password.', loggedIn: false, appName: 'Ticket Bot' });
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

/* ---------------- discord client ---------------- */
let client;
client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message]
});
client.commands = new Collection();

/* ---------------- load commands ---------------- */
const commandsPath = path.join(__dirname, 'commands');
const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
for (const file of files) {
  const full = path.join(commandsPath, file);
  const mod = await import(pathToFileURL(full).href);
  const cmdData = mod?.data ?? mod?.default?.data;
  if (!cmdData || typeof cmdData.name !== 'string') {
    console.warn(`⚠️  Skipping "${file}" — not a slash command (no export "data").`);
    continue;
  }
  console.log(`➕ Loaded command: /${cmdData.name} (${file})`);
  client.commands.set(cmdData.name, mod);
}

/* ---------------- guild data for dashboard ---------------- */
async function getGuildData() {
  const guildId = process.env.GUILD_ID;
  if (!guildId || !client.isReady()) return { roles: [], categories: [] };
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { roles: [], categories: [] };
  const roles = (await guild.roles.fetch())
    .map(r => ({ id: r.id, name: r.name, color: r.color }))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const cats = (await guild.channels.fetch())
    .filter(ch => ch?.type === ChannelType.GuildCategory)
    .map(ch => ({ id: ch.id, name: ch.name }))
    .sort((a,b)=>a.name.localeCompare(b.name));
  return { roles, categories: cats };
}

/* ---------------- dashboard ---------------- */
app.get('/dashboard', requireAuth, async (req, res) => {
  const which = (req.query.panel === '2') ? '2' : '1';
  const cfg = readCfg();
  const panel = readPanel(which);
  const gd = await getGuildData();
  res.render('dashboard', {
    title: 'Dashboard',
    loggedIn: true,
    ready: client?.isReady?.() || false,
    botTag: client?.user?.tag || null,
    guildId: process.env.GUILD_ID || 'n/a',
    cfg, panel,
    which, // "1" or "2"
    guildData: gd,
    appName: 'Ticket Bot'
  });
});

app.post('/dashboard/save-config', requireAuth, (req, res) => {
  let roleIds = [];
  if (typeof req.body.allowedRoleIds === 'string') roleIds = req.body.allowedRoleIds.split(',').filter(Boolean);
  else if (Array.isArray(req.body.allowedRoleIds)) roleIds = req.body.allowedRoleIds;
  writeCfg({
    supportCategoryId: (req.body.supportCategoryId || '').trim(),
    allowedRoleIds: roleIds
  });
  res.redirect(`/dashboard?panel=${req.body.which || '1'}`);
});

/* ---- Save Panel (visual builder posts hidden JSON) ---- */
app.post('/dashboard/save-panel', requireAuth, (req, res) => {
  const which = (req.body.which === '2') ? '2' : '1';

  let options = [];
  if (req.body.optionsJson) {
    try { options = JSON.parse(req.body.optionsJson); } catch {}
  }
  let buttonForm = [];
  if (req.body.buttonFormJson) {
    try { buttonForm = JSON.parse(req.body.buttonFormJson); } catch {}
  }

  writePanel(which, {
    mode: (req.body.mode === 'dropdown') ? 'dropdown' : 'button',
    title: (req.body.title || '').trim(),
    body: (req.body.body || '').trim(),
    buttonLabel: (req.body.buttonLabel || '').trim() || 'Create ticket',
    branding: {
      label: (req.body.brand_label || '').trim(),
      url: (req.body.brand_url || '').trim()
    },
    buttonForm,
    options
  });
  res.redirect(`/dashboard?panel=${which}`);
});

/* ---------------- start web ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web up on :${PORT}`));

/* ---------------- ready ---------------- */
client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ---------------- helpers ---------------- */
function isStaff(member) {
  const cfg = readCfg();
  const allowed = cfg.allowedRoleIds || [];
  const hasAllowedRole = allowed.length ? allowed.some(id => member.roles?.cache?.has(id)) : false;
  const hasManage = member.permissions?.has(PermissionFlagsBits.ManageChannels);
  return hasManage || hasAllowedRole;
}
function getCategoryId() {
  const cfg = readCfg();
  return process.env.SUPPORT_CATEGORY_ID || cfg.supportCategoryId || null;
}
function openerFromTopic(topic) {
  const m = (topic || '').match(/opener:(\d{15,25})/);
  return m ? m[1] : null;
}

/* --------- transcript (simple .txt) ---------- */
async function generateTranscript(channel) {
  const msgs = [];
  let lastId;
  for (let i = 0; i < 10; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId }).catch(()=>null);
    if (!batch || batch.size === 0) break;
    batch.reverse().forEach(m => {
      msgs.push(`[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag || m.author?.id}: ${m.cleanContent || ''}`);
      if (m.attachments.size) {
        m.attachments.forEach(a => msgs.push(`  [attachment] ${a.name} ${a.url}`));
      }
    });
    lastId = batch.first().id;
  }
  const text = `Transcript for #${channel.name}\nGuild: ${channel.guild?.name}\nChannel ID: ${channel.id}\nGenerated: ${new Date().toISOString()}\n\n` + msgs.join('\n');
  return new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `transcript-${channel.id}.txt` });
}

/* ---------- ticket creation ---------- */
async function createTicketChannel(guild, opener, subject, answers = []) {
  const categoryId = getCategoryId();
  if (!categoryId) throw new Error('Support category not set');

  const overwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: opener.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
  ];
  const cfg = readCfg();
  (cfg.allowedRoleIds || []).forEach(rid => {
    overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  });

  const ch = await guild.channels.create({
    name: `ticket-${opener.user.username}-${Date.now().toString().slice(-4)}`,
    type: ChannelType.GuildText,
    parent: categoryId,
    topic: `opener:${opener.id}`,
    permissionOverwrites: overwrites
  });

  const createdAt = `<t:${Math.floor(Date.now() / 1000)}:f>`;
  const ticketId = ch.id;

  const fields = [
    { name: 'Opened by', value: `<@${opener.id}>`, inline: true },
    { name: 'Reason', value: subject || 'no-subject', inline: true },
    { name: 'Created at', value: createdAt, inline: true },
    { name: 'Ticket ID', value: `\`${ticketId}\``, inline: false }
  ];
  if (answers.length) {
    for (const a of answers) fields.push({ name: a.label, value: a.value || '—', inline: false });
  }

  const embed = new EmbedBuilder().setTitle('🎟️ Ticket Created').setColor(0x00b894).addFields(fields);
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setStyle(ButtonStyle.Secondary).setLabel('Claim').setEmoji('🛄'),
    new ButtonBuilder().setCustomId('ticket_close').setStyle(ButtonStyle.Danger).setLabel('Close').setEmoji('🔒')
  );

  await ch.send({ content: `Welcome <@${opener.id}> — support will be with you shortly.`, embeds: [embed], components: [controls] });
  return ch;
}

/* ---------------- interactions ---------------- */
client.on('interactionCreate', async (interaction) => {
  // slash commands
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try { await command.execute(interaction, client); }
    catch (err) {
      console.error(err);
      const msg = '⚠️ Something went wrong.';
      if (interaction.replied || interaction.deferred) await interaction.editReply({ content: msg });
      else await interaction.reply({ content: msg, ephemeral: true });
    }
    return;
  }

  // figure out panel id from customId prefixes: panel1_..., panel2_...
  const cid = interaction.customId || '';
  const which = cid.startsWith('panel2_') || cid.includes(':2') ? '2' : (cid.startsWith('panel1_') || cid.includes(':1') ? '1' : '1');
  const panel = readPanel(which);

  // dropdown -> reset menu UI then modal/create
  if (interaction.isStringSelectMenu() && (cid === `panel${which}_reason`)) {
    // reset to placeholder
    try {
      const rows = [];
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`panel${which}_reason`)
        .setPlaceholder('Select the Contact Reason')
        .addOptions(
          (panel.options || []).slice(0, 25).map((o, idx) => ({
            label: o.label || 'Reason',
            value: `opt_${idx}`,
            description: o.description?.slice(0, 100) || undefined,
            emoji: o.emoji || undefined
          }))
        );
      rows.push(new ActionRowBuilder().addComponents(menu));
      if (panel.branding?.label && panel.branding?.url) {
        rows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(panel.branding.label).setURL(panel.branding.url)
        ));
      }
      await interaction.message.edit({ components: rows });
    } catch {}

    const value = interaction.values?.[0];
    const idx = Number((value || '').split('_')[1] || -1);
    const option = panel.options?.[idx];
    if (!option) return interaction.reply({ content: '❌ Invalid option.', ephemeral: true });

    const form = Array.isArray(option.form) ? option.form : [];
    if (!form.length) {
      await interaction.deferReply({ ephemeral: true });
      const ch = await createTicketChannel(interaction.guild, interaction.member, option.label, []);
      return interaction.editReply({ content: `✅ Ticket created: ${ch}` });
    }

    const modal = new ModalBuilder().setCustomId(`panel${which}_form_option_${idx}`).setTitle(option.label.slice(0, 45));
    const rows2 = [];
    for (const f of form.slice(0, 5)) {
      const input = new TextInputBuilder()
        .setCustomId(f.id)
        .setLabel(f.label?.slice(0, 45) || 'Field')
        .setRequired(!!f.required)
        .setStyle((f.style === 'paragraph') ? TextInputStyle.Paragraph : TextInputStyle.Short);
      if (f.placeholder) input.setPlaceholder(f.placeholder.slice(0, 100));
      if (f.max && Number.isInteger(f.max)) input.setMaxLength(Math.min(4000, f.max));
      rows2.push(new ActionRowBuilder().addComponents(input));
    }
    modal.addComponents(...rows2);
    return interaction.showModal(modal);
  }

  // button create -> modal or create
  if (interaction.isButton() && (cid === `panel${which}_create`)) {
    const form = Array.isArray(panel.buttonForm) ? panel.buttonForm : [];
    if (!form.length) {
      await interaction.deferReply({ ephemeral: true });
      const ch = await createTicketChannel(interaction.guild, interaction.member, 'no-subject', []);
      return interaction.editReply({ content: `✅ Ticket created: ${ch}` });
    }

    const modal = new ModalBuilder().setCustomId(`panel${which}_form_button`).setTitle((panel.buttonLabel || 'Create ticket').slice(0, 45));
    const rows = [];
    for (const f of form.slice(0, 5)) {
      const input = new TextInputBuilder()
        .setCustomId(f.id)
        .setLabel(f.label?.slice(0, 45) || 'Field')
        .setRequired(!!f.required)
        .setStyle((f.style === 'paragraph') ? TextInputStyle.Paragraph : TextInputStyle.Short);
      if (f.placeholder) input.setPlaceholder(f.placeholder.slice(0, 100));
      if (f.max && Number.isInteger(f.max)) input.setMaxLength(Math.min(4000, f.max));
      rows.push(new ActionRowBuilder().addComponents(input));
    }
    modal.addComponents(...rows);
    return interaction.showModal(modal);
  }

  // modal submit
  if (interaction.isModalSubmit()) {
    if (cid.startsWith(`panel${which}_form_option_`)) {
      const idx = Number(cid.split('_').pop());
      const option = panel.options?.[idx];
      const form = Array.isArray(option?.form) ? option.form : [];
      const answers = form.slice(0,5).map(f => ({
        id: f.id, label: f.label || f.id, value: interaction.fields.getTextInputValue(f.id) || ''
      }));
      await interaction.deferReply({ ephemeral: true });
      const ch = await createTicketChannel(interaction.guild, interaction.member, option?.label || 'no-subject', answers);
      return interaction.editReply({ content: `✅ Ticket created: ${ch}` });
    }
    if (cid === `panel${which}_form_button`) {
      const form = Array.isArray(panel.buttonForm) ? panel.buttonForm : [];
      const answers = form.slice(0,5).map(f => ({
        id: f.id, label: f.label || f.id, value: interaction.fields.getTextInputValue(f.id) || ''
      }));
      await interaction.deferReply({ ephemeral: true });
      const ch = await createTicketChannel(interaction.guild, interaction.member, 'no-subject', answers);
      return interaction.editReply({ content: `✅ Ticket created: ${ch}` });
    }
  }

  // staff controls inside tickets
  if (interaction.isButton()) {
    if (cid === 'ticket_claim') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Only staff can claim tickets.', ephemeral: true });
      return interaction.reply({ content: `🛄 <@${interaction.member.id}> claimed this ticket.`, ephemeral: false });
    }

    if (cid === 'ticket_close') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Only staff can close tickets.', ephemeral: true });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_confirm_close').setLabel('Confirm close').setStyle(ButtonStyle.Danger).setEmoji('✅'),
        new ButtonBuilder().setCustomId('ticket_cancel_close').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ content: 'Are you sure you want to close this ticket?', components: [row], ephemeral: true });
    }

    if (cid === 'ticket_cancel_close') {
      return interaction.update({ content: '❎ Close cancelled.', components: [] });
    }

    if (cid === 'ticket_confirm_close') {
      const openerId = openerFromTopic(interaction.channel.topic);
      if (openerId) {
        try {
          await interaction.channel.permissionOverwrites.edit(openerId, { ViewChannel: false, SendMessages: false }, { reason: 'Ticket closed' });
        } catch {}
      }
      const closed = new EmbedBuilder().setColor(0xffcc00).setDescription(`Ticket Closed by <@${interaction.user.id}>`);
      const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_transcript').setStyle(ButtonStyle.Secondary).setLabel('Transcript').setEmoji('📄'),
        new ButtonBuilder().setCustomId('ticket_open').setStyle(ButtonStyle.Primary).setLabel('Open').setEmoji('🔓'),
        new ButtonBuilder().setCustomId('ticket_delete').setStyle(ButtonStyle.Danger).setLabel('Delete').setEmoji('⛔')
      );
      await interaction.update({ content: '🔒 Ticket closed.', components: [] });
      return interaction.channel.send({ embeds: [closed], components: [controls] });
    }

    if (cid === 'ticket_transcript') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const file = await generateTranscript(interaction.channel);
      return interaction.reply({ files: [file], ephemeral: true });
    }

    if (cid === 'ticket_open') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const openerId = openerFromTopic(interaction.channel.topic);
      if (openerId) {
        try {
          await interaction.channel.permissionOverwrites.edit(openerId, {
            ViewChannel: true, SendMessages: true, ReadMessageHistory: true
          }, { reason: 'Ticket reopened' });
        } catch {}
      }
      return interaction.reply({ content: '🔓 Ticket reopened.', ephemeral: false });
    }

    if (cid === 'ticket_delete') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      try { await interaction.channel.delete('Ticket deleted by staff'); } catch {
        return interaction.reply({ content: '❌ I need Manage Channels permission.', ephemeral: true });
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
