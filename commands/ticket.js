// commands/ticket.js
import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG_PATH = path.join(__dirname, '..', 'data', 'config.json');
const readCfg = () => JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Open or close a support ticket.')
  // NOTE: default permissions CANNOT be set on a subcommand.
  // We keep the command open to everyone; we’ll enforce perms in code for /ticket close.
  .addSubcommand(sc =>
    sc.setName('open')
      .setDescription('Open a private ticket')
      .addStringOption(o =>
        o.setName('subject')
          .setDescription('Short subject')
          .setRequired(false)
      )
  )
  .addSubcommand(sc =>
    sc.setName('close')
      .setDescription('Close this ticket (run inside a ticket channel).')
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'open') {
    const subject = interaction.options.getString('subject') || 'no-subject';

    // env takes priority; fall back to the dashboard JSON file
    const envCat = process.env.SUPPORT_CATEGORY_ID;
    const envRole = process.env.SUPPORT_ROLE_ID;
    const fileCfg = readCfg();
    const categoryId = envCat || fileCfg.supportCategoryId;
    const staffRoleId = envRole || fileCfg.supportRoleId;

    if (!categoryId) {
      return interaction.reply({
        content: '❌ Support category is not set. Configure it on /dashboard.',
        ephemeral: true
      });
    }

    const guild = interaction.guild;
    const member = interaction.member;

    // Only opener + staff can see; hide @everyone
    const overwrites = [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ];
    if (staffRoleId) {
      overwrites.push({
        id: staffRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      });
    }

    const ch = await guild.channels.create({
      name: `ticket-${member.user.username}-${Date.now().toString().slice(-4)}`,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: overwrites
    });

    await ch.send(
      `🎟️ **Ticket opened by <@${member.id}>** — subject: *${subject}*.\nA staff member will be with you shortly.`
    );
    return interaction.reply({ content: `✅ Ticket created: ${ch}`, ephemeral: true });
  }

  if (sub === 'close') {
    // Enforce permission here (since we can’t do per-subcommand defaults):
    // Require ManageChannels OR possession of the configured staff role.
    const member = interaction.member;
    const hasManage = member.permissions?.has(PermissionFlagsBits.ManageChannels);
    const staffRoleId = process.env.SUPPORT_ROLE_ID || readCfg().supportRoleId || '';

    const hasStaffRole = staffRoleId ? member.roles?.cache?.has(staffRoleId) : false;

    if (!hasManage && !hasStaffRole) {
      return interaction.reply({
        content: '❌ You need **Manage Channels** permission or the **staff role** to close tickets.',
        ephemeral: true
      });
    }

    try {
      await interaction.channel.delete('Ticket closed');
    } catch {
      return interaction.reply({
        content: '❌ I need **Manage Channels** permission to delete this channel.',
        ephemeral: true
      });
    }
  }
}
