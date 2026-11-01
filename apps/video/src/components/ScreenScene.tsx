import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { colors, fontFamily, SHOT } from '../theme';

/** [x, y, width, height] in screenshot pixels (1920x1080). */
export type Rect = readonly [number, number, number, number];

export type Step = {
  /** Seconds from the start of the scene. */
  readonly from: number;
  readonly caption: string;
  /** Zoom to and outline this part of the screen; omitted = whole screen. */
  readonly focus?: Rect;
};

export type Shot = {
  readonly src: string;
  /** Seconds from the start of the scene; the first shot starts at 0. */
  readonly from: number;
};

type Props = {
  readonly chapter: string;
  readonly shots: readonly Shot[];
  readonly steps: readonly Step[];
};

// The app window on the video frame.
export const WIN = { left: 240, top: 40, width: 1440, height: 810 };
const BASE = WIN.width / SHOT.width;
const MOVE_FRAMES = 24;

type Camera = { x: number; y: number; z: number };

const cameraFor = (focus?: Rect): Camera => {
  if (!focus) return { x: 0, y: 0, z: 1 };
  const [fx, fy, fw, fh] = focus;
  const z = Math.max(
    1,
    Math.min(2.2, (0.8 * SHOT.width) / fw, (0.8 * SHOT.height) / fh),
  );
  const vw = SHOT.width / z;
  const vh = SHOT.height / z;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return {
    x: clamp(fx + fw / 2 - vw / 2, SHOT.width - vw),
    y: clamp(fy + fh / 2 - vh / 2, SHOT.height - vh),
    z,
  };
};

const ease = Easing.bezier(0.33, 1, 0.68, 1);

const stepIndex = (steps: readonly Step[], frame: number, fps: number) => {
  let i = 0;
  steps.forEach((s, j) => {
    if (frame >= s.from * fps) i = j;
  });
  return i;
};

const Screen = ({ shots, steps }: Pick<Props, 'shots' | 'steps'>) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const i = stepIndex(steps, frame, fps);
  const start = steps[i].from * fps;
  const from = cameraFor(steps[Math.max(0, i - 1)].focus);
  const to = cameraFor(steps[i].focus);
  const t = interpolate(frame, [start, start + MOVE_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  const cam = {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  };
  const k = BASE * cam.z;
  const focus = steps[i].focus;
  const outline = interpolate(
    frame,
    [start + MOVE_FRAMES - 6, start + MOVE_FRAMES + 6],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const pad = 8;

  return (
    <div
      style={{
        position: 'absolute',
        ...WIN,
        overflow: 'hidden',
        borderRadius: 14,
        border: `1px solid ${colors.line}`,
        boxShadow: '0 24px 60px rgba(24,24,27,0.12)',
        backgroundColor: colors.panel,
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: SHOT.width,
          height: SHOT.height,
          transformOrigin: '0 0',
          scale: String(k),
          translate: `${-cam.x * k}px ${-cam.y * k}px`,
        }}
      >
        {shots.map((s) => (
          <Img
            key={s.src}
            src={staticFile(s.src)}
            style={{
              position: 'absolute',
              inset: 0,
              width: SHOT.width,
              height: SHOT.height,
              opacity:
                s.from === 0
                  ? 1
                  : interpolate(
                      frame,
                      [s.from * fps, s.from * fps + 12],
                      [0, 1],
                      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
                    ),
            }}
          />
        ))}
      </div>
      {focus ? (
        <div
          style={{
            position: 'absolute',
            left: (focus[0] - cam.x) * k - pad,
            top: (focus[1] - cam.y) * k - pad,
            width: focus[2] * k + 2 * pad,
            height: focus[3] * k + 2 * pad,
            borderRadius: 12,
            border: `4px solid ${colors.highlight}`,
            boxShadow: '0 0 0 4000px rgba(24,24,27,0.28)',
            opacity: outline,
          }}
        />
      ) : null}
    </div>
  );
};

export const Caption = ({
  chapter,
  steps,
}: Pick<Props, 'chapter' | 'steps'>) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const i = stepIndex(steps, frame, fps);
  const start = steps[i].from * fps;
  return (
    <div
      style={{
        position: 'absolute',
        left: WIN.left,
        width: WIN.width,
        top: WIN.top + WIN.height + 28,
        fontFamily,
      }}
    >
      <div
        style={{
          color: colors.accent,
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {chapter}
      </div>
      <div
        style={{
          marginTop: 8,
          color: colors.ink,
          fontSize: 52,
          fontWeight: 600,
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          opacity: interpolate(frame, [start, start + 10], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          translate: `0px ${interpolate(frame, [start, start + 10], [12, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease,
          })}px`,
        }}
      >
        {steps[i].caption}
      </div>
    </div>
  );
};

/** One app screen (or a cross-fade between two) with a guided camera. */
export const ScreenScene = ({ chapter, shots, steps }: Props) => (
  <AbsoluteFill style={{ backgroundColor: colors.bg }}>
    <Screen shots={shots} steps={steps} />
    <Caption chapter={chapter} steps={steps} />
  </AbsoluteFill>
);
