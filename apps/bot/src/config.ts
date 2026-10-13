export type BotConfig = {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string;
  adminRoleName: string;
  webBaseUrl: string;
  databaseUrl: string;
  storageDir: string;
};

const VARS = [
  ['DISCORD_TOKEN', 'discordToken'],
  ['DISCORD_CLIENT_ID', 'discordClientId'],
  ['DISCORD_GUILD_ID', 'discordGuildId'],
  ['WEB_BASE_URL', 'webBaseUrl'],
  ['DATABASE_URL', 'databaseUrl'],
  ['STORAGE_DIR', 'storageDir'],
] as const satisfies readonly (readonly [
  string,
  Exclude<keyof BotConfig, 'adminRoleName'>,
])[];

export const DEFAULT_ADMIN_ROLE_NAME = 'Studies Admin';

export function loadConfig(env: NodeJS.ProcessEnv): BotConfig {
  const missing = VARS.filter(([k]) => !env[k]).map(([k]) => k);
  if (missing.length > 0) throw new Error(`Missing env: ${missing.join(', ')}`);
  const out: Partial<BotConfig> = {};
  for (const [k, prop] of VARS) out[prop] = env[k] as string;
  out.adminRoleName = env.ADMIN_ROLE_NAME || DEFAULT_ADMIN_ROLE_NAME;
  return out as BotConfig;
}
