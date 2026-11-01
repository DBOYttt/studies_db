import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { colors, fontFamily, monoFamily } from '../theme';

type Props = {
  readonly title: string;
  readonly lines: readonly string[];
  /** Shown in a monospace chip under the lines, e.g. a command. */
  readonly chip?: string;
};

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const Rise = ({
  delay,
  children,
}: {
  readonly delay: number;
  readonly children: React.ReactNode;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = delay * fps;
  return (
    <div
      style={{
        opacity: interpolate(frame, [start, start + 15], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
        translate: `0px ${interpolate(frame, [start, start + 20], [24, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: ease,
        })}px`,
      }}
    >
      {children}
    </div>
  );
};

/** Opening and closing card: the app's name and a few lines. */
export const TitleCard = ({ title, lines, chip }: Props) => (
  <AbsoluteFill
    style={{
      backgroundColor: colors.bg,
      fontFamily,
      justifyContent: 'center',
      paddingLeft: 240,
      paddingRight: 240,
    }}
  >
    <Rise delay={0}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <Img
          src={staticFile('app-icon.svg')}
          style={{ width: 104, height: 104 }}
        />
        <div
          style={{
            fontSize: 128,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            color: colors.ink,
          }}
        >
          {title}
        </div>
      </div>
    </Rise>
    {lines.map((line, i) => (
      <Rise key={line} delay={0.4 + i * 0.3}>
        <div
          style={{
            marginTop: i === 0 ? 40 : 12,
            fontSize: 56,
            fontWeight: 500,
            color: i === 0 ? colors.ink : colors.muted,
            lineHeight: 1.2,
          }}
        >
          {line}
        </div>
      </Rise>
    ))}
    {chip ? (
      <Rise delay={0.4 + lines.length * 0.3}>
        <div
          style={{
            marginTop: 44,
            display: 'inline-block',
            fontFamily: monoFamily,
            fontSize: 52,
            color: colors.accent,
            backgroundColor: colors.panel,
            border: `2px solid ${colors.line}`,
            borderRadius: 12,
            padding: '12px 28px',
          }}
        >
          {chip}
        </div>
      </Rise>
    ) : null}
  </AbsoluteFill>
);
