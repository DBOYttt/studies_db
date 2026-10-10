export type BotConfig = {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string;
  adminRoleId: string;
  webBaseUrl: string;
  databaseUrl: string;
  storageDir: string;
};

const VARS = [
  ['DISCORD_TOKEN', 'discordToken'],
  ['DISCORD_CLIENT_ID', 'discordClientId'],
  ['DISCORD_GUILD_ID', 'discordGuildId'],
  ['ADMIN_ROLE_ID', 'adminRoleId'],
  ['WEB_BASE_URL', 'webBaseUrl'],
  ['DATABASE_URL', 'databaseUrl'],
  ['STORAGE_DIR', 'storageDir'],
] as const satisfies readonly (readonly [string, keyof BotConfig])[];

export function loadConfig(env: NodeJS.ProcessEnv): BotConfig {
  const missing = VARS.filter(([k]) => !env[k]).map(([k]) => k);
  if (missing.length > 0) throw new Error(`Missing env: ${missing.join(', ')}`);
  const out: Partial<BotConfig> = {};
  for (const [k, prop] of VARS) out[prop] = env[k] as string;
  return out as BotConfig;
}
