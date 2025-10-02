// deploy-commands.js (robust loader)
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const commandsPath = path.join(__dirname, 'commands');
const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
const commandData = [];

for (const file of files) {
  const full = path.join(commandsPath, file);
  const mod = await import(pathToFileURL(full).href);

  // try named export first, then default export shape
  const maybe = mod?.data ?? mod?.default?.data;
  if (!maybe || typeof maybe.toJSON !== 'function') {
    console.warn(`⚠️  Skipping "${file}" — no export named "data" with toJSON().`);
    continue;
  }

  console.log(`➕ Loading slash command from ${file}`);
  commandData.push(maybe.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log('Registering commands (guild)…');
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commandData }
  );
  console.log('✅ Commands registered.');
} catch (e) {
  console.error(e);
}
