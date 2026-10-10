import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './commands/definitions.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);
const rest = new REST().setToken(config.discordToken);
await rest.put(
  Routes.applicationGuildCommands(
    config.discordClientId,
    config.discordGuildId,
  ),
  { body: commandDefinitions },
);
console.log(`Registered ${commandDefinitions.length} commands.`);
