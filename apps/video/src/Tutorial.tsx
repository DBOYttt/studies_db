import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { ScreenScene } from './components/ScreenScene';
import { InstallScene } from './scenes/InstallScene';
import { SignInScene } from './scenes/SignInScene';
import { TitleCard } from './scenes/TitleCard';

// Screens come from scripts/capture-screens.mjs (seeded dev data, student
// seed-u1). Focus rects are in screenshot pixels; recapture and re-check them
// when the web UI changes.
export const FADE = 15;

export const Tutorial = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence name="Intro" durationInFrames={150}>
      <TitleCard
        title="Studies DB"
        lines={[
          'A quick tour for students.',
          'Materials, timetable and events of your year.',
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Sign in: Discord" durationInFrames={270}>
      <SignInScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Sign in: confirm" durationInFrames={150}>
      <ScreenScene
        chapter="Sign in"
        shots={[{ src: 'screens/confirm.png', from: 0 }]}
        steps={[
          {
            from: 0,
            caption: 'Open the link and press Sign in.',
            focus: [770, 490, 380, 130],
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Start" durationInFrames={390}>
      <ScreenScene
        chapter="Start"
        shots={[{ src: 'screens/start.png', from: 0 }]}
        steps={[
          { from: 0, caption: 'Start shows your day at a glance.' },
          {
            from: 3,
            caption: "Today's classes and your next class.",
            focus: [332, 88, 1296, 180],
          },
          {
            from: 6.5,
            caption: 'Upcoming tests, exams and other events.',
            focus: [332, 285, 1296, 270],
          },
          {
            from: 10,
            caption: 'All subjects of your year. Open one to see its files.',
            focus: [332, 590, 1296, 490],
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Semester" durationInFrames={270}>
      <ScreenScene
        chapter="Semester"
        shots={[
          { src: 'screens/start.png', from: 0 },
          { src: 'screens/start-sem2.png', from: 3.5 },
        ]}
        steps={[
          {
            from: 0,
            caption: 'Use Semester to look at one semester at a time.',
            focus: [1231, 12, 182, 34],
          },
          {
            from: 3.5,
            caption:
              'Semester 2 shows only its subjects and classes. Events without a subject always stay.',
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Subject" durationInFrames={330}>
      <ScreenScene
        chapter="Subjects and files"
        shots={[{ src: 'screens/subject.png', from: 0 }]}
        steps={[
          { from: 0, caption: 'A subject page lists all its files.' },
          {
            from: 3,
            caption: 'Narrow the list by class or by type.',
            focus: [332, 278, 1296, 170],
          },
          {
            from: 6.5,
            caption: 'Preview a file or download it.',
            focus: [332, 730, 1296, 100],
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Preview" durationInFrames={180}>
      <ScreenScene
        chapter="Subjects and files"
        shots={[{ src: 'screens/preview.png', from: 0 }]}
        steps={[
          {
            from: 0,
            caption: 'The preview opens next to the list.',
            focus: [1490, 58, 430, 1022],
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Timetable" durationInFrames={330}>
      <ScreenScene
        chapter="Timetable"
        shots={[{ src: 'screens/plan.png', from: 0 }]}
        steps={[
          { from: 0, caption: 'Timetable shows your classes week by week.' },
          {
            from: 3,
            caption: 'Move between weeks, or jump back to Today.',
            focus: [1229, 234, 260, 40],
          },
          {
            from: 6.5,
            caption: 'Tests and entry quizzes are marked on their class.',
            focus: [600, 450, 620, 240],
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="My groups" durationInFrames={330}>
      <ScreenScene
        chapter="Timetable"
        shots={[
          { src: 'screens/groups.png', from: 0 },
          { src: 'screens/plan.png', from: 7.5 },
        ]}
        steps={[
          {
            from: 0,
            caption: 'In My groups, pick your group in each class.',
            focus: [332, 448, 920, 632],
          },
          {
            from: 4,
            caption: 'Or import your groups from your UniTime calendar link.',
            focus: [332, 235, 920, 178],
          },
          {
            from: 7.5,
            caption:
              'The week then shows lectures and only your groups, and says which classes still need a pick.',
            focus: [332, 288, 637, 37],
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Events" durationInFrames={210}>
      <ScreenScene
        chapter="Events"
        shots={[{ src: 'screens/events.png', from: 0 }]}
        steps={[
          {
            from: 0,
            caption: 'Events lists upcoming tests, exams, trips and more.',
          },
          {
            from: 3.5,
            caption: 'Any student can add one.',
            focus: [1501, 102, 126, 38],
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Add event" durationInFrames={240}>
      <ScreenScene
        chapter="Events"
        shots={[{ src: 'screens/event-new.png', from: 0 }]}
        steps={[
          {
            from: 0,
            caption: 'Choose a type, an optional subject, a title and a date.',
            focus: [332, 180, 690, 400],
          },
          {
            from: 4,
            caption: 'It can repeat every week or every 2 weeks.',
            focus: [332, 795, 690, 64],
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Event page" durationInFrames={240}>
      <ScreenScene
        chapter="Events"
        shots={[{ src: 'screens/event.png', from: 0 }]}
        steps={[
          {
            from: 0,
            caption: 'Each event has a page with its details and materials.',
          },
          {
            from: 4,
            caption: "Files you add here go to the event's thread on Discord.",
            focus: [332, 740, 1296, 120],
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Search" durationInFrames={210}>
      <ScreenScene
        chapter="Search"
        shots={[{ src: 'screens/search.png', from: 0 }]}
        steps={[
          {
            from: 0,
            caption: 'Search from the box at the top of the sidebar.',
            focus: [15, 65, 267, 45],
          },
          {
            from: 3.5,
            caption: 'It finds files by name and by the text inside them.',
            focus: [332, 176, 1296, 398],
          },
        ]}
      />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Install" durationInFrames={390}>
      <InstallScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE })}
    />
    <TransitionSeries.Sequence name="Outro" durationInFrames={150}>
      <TitleCard
        title="Studies DB"
        lines={['Ready? Sign in from your Discord server:']}
        chip="/link"
      />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
