import { Composition } from 'remotion';
import { Tutorial } from './Tutorial';

// 15 scenes, 14 fades of 15 frames (TransitionSeries overlaps them).
export const RemotionRoot = () => (
  <Composition
    id="Tutorial"
    component={Tutorial}
    durationInFrames={3840 - 14 * 15}
    fps={30}
    width={1920}
    height={1080}
  />
);
