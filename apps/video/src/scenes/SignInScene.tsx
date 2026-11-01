import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Caption, WIN } from '../components/ScreenScene';
import { colors, fontFamily, monoFamily } from '../theme';

// A neutral chat window standing in for Discord. Every text here is the bot's
// real text (apps/bot/src/commands/definitions.ts, student.ts, router.ts).
const chat = {
  bg: '#313338',
  side: '#2b2d31',
  ink: '#f2f3f5',
  muted: '#b5bac1',
  input: '#383a40',
  link: '#00a8fc',
};

const fade = (frame: number, at: number) =>
  interpolate(frame, [at, at + 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const rise = (frame: number, at: number) =>
  `0px ${interpolate(frame, [at, at + 14], [16, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  })}px`;

const BotMessage = ({
  children,
  note,
}: {
  readonly children: React.ReactNode;
  readonly note?: string;
}) => (
  <div style={{ display: 'flex', gap: 18 }}>
    <Img
      src={staticFile('app-icon.svg')}
      style={{ width: 52, height: 52, borderRadius: 26, flexShrink: 0 }}
    />
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: chat.ink, fontWeight: 600, fontSize: 26 }}>
          Bot
        </span>
        <span
          style={{
            backgroundColor: '#5865f2',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 4,
            padding: '2px 6px',
          }}
        >
          APP
        </span>
      </div>
      <div
        style={{
          color: chat.ink,
          fontSize: 26,
          lineHeight: 1.4,
          marginTop: 4,
        }}
      >
        {children}
      </div>
      {note ? (
        <div style={{ color: chat.muted, fontSize: 19, marginTop: 6 }}>
          {note}
        </div>
      ) : null}
    </div>
  </div>
);

const Pane = ({
  title,
  children,
  style,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly style?: React.CSSProperties;
}) => (
  <div
    style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: chat.bg,
      borderRadius: 14,
      overflow: 'hidden',
      ...style,
    }}
  >
    <div
      style={{
        backgroundColor: chat.side,
        color: chat.ink,
        fontSize: 24,
        fontWeight: 600,
        padding: '18px 28px',
      }}
    >
      {title}
    </div>
    <div
      style={{
        flex: 1,
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: 26,
      }}
    >
      {children}
    </div>
  </div>
);

export const SignInScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const typed = '/link'.slice(
    0,
    Math.floor(
      interpolate(frame, [0.4 * fps, 1.2 * fps], [0, 5], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    ),
  );
  const replyAt = 2.3 * fps;
  const dmAt = 4.2 * fps;
  const menu =
    fade(frame, 0.8 * fps) *
    interpolate(frame, [replyAt - 8, replyAt], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily }}>
      <div
        style={{
          position: 'absolute',
          ...WIN,
          display: 'flex',
          gap: 24,
        }}
      >
        <Pane title="Your year's Discord server">
          <div
            style={{
              opacity: fade(frame, replyAt),
              translate: rise(frame, replyAt),
            }}
          >
            <BotMessage note="Only you can see this">
              I sent you the link in a direct message.
            </BotMessage>
          </div>
          <div style={{ position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                bottom: 84,
                left: 0,
                right: 0,
                backgroundColor: chat.side,
                borderRadius: 10,
                padding: '16px 22px',
                opacity: menu,
              }}
            >
              <span
                style={{
                  color: chat.ink,
                  fontSize: 26,
                  fontFamily: monoFamily,
                }}
              >
                /link
              </span>
              <span style={{ color: chat.muted, fontSize: 22, marginLeft: 18 }}>
                Get a sign-in link for the website
              </span>
            </div>
            <div
              style={{
                backgroundColor: chat.input,
                borderRadius: 10,
                padding: '18px 22px',
                fontSize: 28,
                fontFamily: monoFamily,
                color: typed ? chat.ink : chat.muted,
                height: 68,
                boxSizing: 'border-box',
              }}
            >
              {frame < replyAt ? typed || 'Message' : 'Message'}
            </div>
          </div>
        </Pane>
        <Pane
          title="Direct message"
          style={{ opacity: fade(frame, dmAt), translate: rise(frame, dmAt) }}
        >
          <BotMessage>
            Your Studies DB link (valid for 15 minutes, single use):{' '}
            <span style={{ color: chat.link }}>
              https://…/auth/callback?token=…
            </span>
            <br />
            Using the installed app? Copy this link and paste it on the app's
            sign-in screen.
          </BotMessage>
        </Pane>
      </div>
      <Caption
        chapter="Sign in"
        steps={[
          { from: 0, caption: "On your year's Discord server, type /link." },
          {
            from: 4.2,
            caption:
              'The bot sends you a one-time sign-in link in a direct message.',
          },
        ]}
      />
    </AbsoluteFill>
  );
};
