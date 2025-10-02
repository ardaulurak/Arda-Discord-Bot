// commands/panel1.js
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PANEL_FILE = path.join(DATA_DIR, 'panel1.json');
const CFG_FILE = path.join(DATA_DIR, 'config.json');

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function parseEmoji(input) {
  if (!input) return undefined;
  const s = String(input).trim();
  // Custom emoji like <:name:123> or <a:name:123>
  const m = s.match(/^<(?:(a)?):(\w+):(\d+)>$/);
  if (m) return { animated: !!m[1], name: m[2], id: m[3] };
  // Otherwise assume unicode emoji
  return s;
}

function buildPanelComponents(panel, which = 1) {
  const rows = [];
  if (panel.mode === 'dropdown') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`panel${which}_reason`)
      .setPlaceholder('Select the Contact Reason')
      .addOptions(
        (panel.options || []).slice(0, 25).map((o, idx) => ({
          label: o.label?.slice(0, 100) || 'Reason',
          value: `opt_${idx}`,
          description: o.description?.slice(0, 100) || undefined,
          emoji: parseEmoji(o.emoji),
        }))
      );
    rows.push(new ActionRowBuilder().addComponents(menu));

    if (panel.branding?.label && panel.branding?.url) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(panel.branding.label)
            .setURL(panel.branding.url)
        )
      );
    }
  } else {
    const createBtn = new ButtonBuilder()
      .setCustomId(`panel${which}_create`)
      .setStyle(ButtonStyle.Primary)
      .setLabel(panel.buttonLabel || 'Create ticket');

    const comps = [createBtn];
    if (panel.branding?.label && panel.branding?.url) {
      comps.push(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(panel.branding.label).setURL(panel.branding.url)
      );
    }
    rows.push(new ActionRowBuilder().addComponents(comps));
  }
  return rows;
}

export const data = new SlashCommandBuilder()
  .setName('panel1')
  .setDescription('Manage or post Ticket Panel #1')
  .addSubcommand((sc) => sc.setName('post').setDescription('Post Panel #1 in this channel'));

export async function execute(interaction /*, client */) {
  if (interaction.options.getSubcommand() !== 'post') return;

  // Permission check: Manage Channels or staff role from config
  const cfg = readJSON(CFG_FILE);
  const allowed = new Set(cfg.allowedRoleIds || []);
  const member = interaction.member;

  const isStaff =
    member.permissions?.has(PermissionFlagsBits.ManageChannels) ||
    [...allowed].some((rid) => member.roles?.cache?.has(rid));
  if (!isStaff) {
    return interaction.reply({ content: '❌ You need Manage Channels or a staff role.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const panel = readJSON(PANEL_FILE);
  const embed = new EmbedBuilder()
    .setTitle(panel.title || 'Support')
    .setDescription(panel.body || 'Use the control below to open a ticket.')
    .setColor(0xffa500);

  const rows = buildPanelComponents(panel, 1);

  await interaction.channel.send({ embeds: [embed], components: rows });

  return interaction.editReply('✅ Panel #1 posted.');
}
