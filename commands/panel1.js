import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_PATH = path.join(__dirname, '..', 'data', 'panel1.json');
const CFG_PATH   = path.join(__dirname, '..', 'data', 'config.json');

const readPanel = () => JSON.parse(fs.readFileSync(PANEL_PATH, 'utf8'));
const readCfg   = () => JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

export const data = new SlashCommandBuilder()
  .setName('panel1')
  .setDescription('Ticket panel #1 controls')
  .addSubcommand(sc => sc.setName('post').setDescription('Post Panel #1 in this channel'));

export async function execute(interaction) {
  const member = interaction.member;
  const cfg = readCfg();
  const allowed = cfg.allowedRoleIds || [];
  const canPost = member.permissions?.has(PermissionFlagsBits.ManageChannels) ||
    (allowed.length && allowed.some(rid => member.roles?.cache?.has(rid)));
  if (!canPost) return interaction.reply({ content: '❌ You need Manage Channels or a staff role.', ephemeral: true });

  const p = readPanel();
  const embed = new EmbedBuilder()
    .setTitle(p.title || 'Support')
    .setDescription(p.body || 'Use the control below to open a ticket.')
    .setColor(0xffa500);

  const rows = [];

  if (p.mode === 'dropdown') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('panel1_reason')
      .setPlaceholder('Select the Contact Reason')
      .addOptions(
        (p.options || []).slice(0, 25).map((o, idx) => ({
          label: o.label || 'Reason',
          value: `opt_${idx}`,
          description: o.description?.slice(0, 100) || undefined,
          emoji: o.emoji || undefined
        }))
      );
    rows.push(new ActionRowBuilder().addComponents(menu));
    if (p.branding?.label && p.branding?.url) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(p.branding.label).setURL(p.branding.url)
      ));
    }
  } else {
    const createBtn = new ButtonBuilder().setCustomId('panel1_create').setStyle(ButtonStyle.Primary).setLabel(p.buttonLabel || 'Create ticket');
    const comps = [createBtn];
    if (p.branding?.label && p.branding?.url) {
      comps.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(p.branding.label).setURL(p.branding.url));
    }
    rows.push(new ActionRowBuilder().addComponents(comps));
  }

  await interaction.reply({ content: '✅ Panel #1 posted.', ephemeral: true });
  await interaction.channel.send({ embeds: [embed], components: rows });
}
