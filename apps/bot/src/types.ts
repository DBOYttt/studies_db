export type ThreadInfo = {
  threadId: string;
  forumChannelId: string;
  title: string;
  ownerDiscordId: string | null;
  /** Started by this bot (e.g. /setup posts); never auto-created as a topic. */
  ownerIsBot?: boolean;
  tagIds: string[];
};
export type ForumTag = { id: string; name: string };
export type DiscordUser = {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
};
