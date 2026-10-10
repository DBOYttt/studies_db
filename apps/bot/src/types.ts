export type ThreadInfo = {
  threadId: string;
  forumChannelId: string;
  title: string;
  ownerDiscordId: string | null;
  tagIds: string[];
};
export type ForumTag = { id: string; name: string };
export type DiscordUser = {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
};
