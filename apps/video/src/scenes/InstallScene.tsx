import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Caption, type Step } from '../components/ScreenScene';
import { colors, fontFamily } from '../theme';

// iPhone captures are 1170x1992 (390x664 CSS px at 3x).
const PHONE = { width: 458, height: 780, left: 330, top: 40 };
const K = PHONE.width / 1170;
// The install icon in the phone top bar (screenshot px).
const ICON = { x: 425, y: 30, size: 80 };

const steps: Step[] = [
  { from: 0, caption: 'On your phone, tap the install icon in the top bar.' },
  {
    from: 3,
    caption: 'Android: confirm when the browser offers to install it.',
  },
  {
    from: 6,
    caption: 'iPhone (Safari): a guide opens. Share, Add to Home Screen, Add.',
  },
  {
    from: 9.5,
    caption:
      'In the iPhone app, paste the link the bot sends after /link to sign in.',
  },
];

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const InstallScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const guide = interpolate(frame, [6 * fps, 6 * fps + 12], [0, 1], clamp);
  const ring =
    interpolate(frame, [0.6 * fps, 0.9 * fps], [0, 1], clamp) *
    interpolate(frame, [2.7 * fps, 3 * fps], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily }}>
      <div
        style={{
          position: 'absolute',
          left: PHONE.left - 16,
          top: PHONE.top - 16,
          width: PHONE.width + 32,
          height: PHONE.height + 32,
          borderRadius: 64,
          backgroundColor: '#18181b',
          boxShadow: '0 24px 60px rgba(24,24,27,0.2)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          ...PHONE,
          borderRadius: 50,
          overflow: 'hidden',
          backgroundColor: colors.panel,
        }}
      >
        <Img
          src={staticFile('screens/phone-start.png')}
          style={{ position: 'absolute', inset: 0, width: '100%' }}
        />
        <Img
          src={staticFile('screens/phone-install.png')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            opacity: guide,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: ICON.x * K - 6,
            top: ICON.y * K - 6,
            width: ICON.size * K + 12,
            height: ICON.size * K + 12,
            borderRadius: 14,
            border: `4px solid ${colors.highlight}`,
            opacity: ring,
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 900,
          top: 160,
          width: 780,
          color: colors.ink,
        }}
      >
        <div
          style={{ fontSize: 72, fontWeight: 700, letterSpacing: '-0.02em' }}
        >
          Install the app
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 40,
            lineHeight: 1.35,
            color: colors.muted,
          }}
        >
          Studies DB opens like an app from your home screen. You stay signed in
          as long as you open it at least once every 30 days.
        </div>
      </div>
      <Caption chapter="Install the app" steps={steps} />
    </AbsoluteFill>
  );
};
