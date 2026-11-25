# Tunesmith

A desktop app for finding a melody by ear and turning it into a song, without needing to know music theory.

1. **Find your melody.** Play it on the on-screen piano, your computer keys, or a USB/MIDI keyboard, or just **hum it** into the microphone. Tunesmith writes the notes down and works out the key.
2. **Get chords.** Click **Find chords for my melody**, or type the chord you want to start on ("C minor", "Am", "F#7"…) and Tunesmith suggests what can come next, with a plain-language note on how each one feels.
3. **Expand with AI.** Continue the tune, make a variation, or get better chords. Claude writes ideas that fit your song (you can tell it things like "make it more hopeful"); a built-in idea engine works offline without an account.

Every idea is shown as a preview you can listen to first; **Undo** always brings back the old version.

## Features

- **12 instruments:** piano, electric piano, acoustic guitar, strings, organ, choir, flute, synth lead, warm pad, bass, music box and marimba. Melody and chords can each have their own, and all are synthesised, so it works offline.
- **Three ways to enter notes:**
  - **Just play:** try notes out, nothing is written down.
  - **Add notes:** each note you play is added, at the length you pick.
  - **Record in time:** play along to a click; the timing is tidied up for you.
- **Hum it:** sing, hum or whistle; a tuner shows whether you're in tune.
- **Fixing notes:** click a note, then ↑ ↓ change the pitch, Shift ← → change the length, Delete removes it.
- **Key detection** with an optional manual key, and dots on the piano showing which notes belong to the key.
- **Chords:**
  - "What could come next?" suggestions;
  - famous progressions (Epic, Flamenco, 50s ballad…) turned to start on your chord;
  - click any chord on the timeline to hear alternatives and swap them;
  - played held, strummed, broken (arpeggio) or on the beat.
- **Save and open** songs (`.tunesmith` files), and **export MIDI** for GarageBand, Logic, FL Studio, Ableton or MuseScore.

## Install

### Option A: download an installer
In GitHub, open **Actions → Tunesmith desktop app → Run workflow**. When it finishes, download **Tunesmith-macOS** (`.dmg`), **Tunesmith-Windows** (`.exe`) or **Tunesmith-Linux** (`.AppImage`) from the run's **Artifacts**.

The installers are not signed with an Apple or Microsoft certificate, so the first launch needs one extra step:
- **macOS:** if it says the app can't be opened, go to **System Settings → Privacy & Security** and click **Open Anyway**. If it says the app is "damaged", run `xattr -cr /Applications/Tunesmith.app` in Terminal.
- **Windows:** on "Windows protected your PC", click **More info → Run anyway**.

### Option B: run from source
Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
cd tunesmith
npm install
npm start          # opens the desktop app
```

`npm run dist` builds an installer for your own system into `tunesmith/dist/`. `npm run web` serves the app at http://localhost:5174 for a normal browser (there the built-in idea engine is used instead of Claude).

## Claude (AI ideas)

1. Create an API key at [console.anthropic.com](https://console.anthropic.com/settings/keys).
2. In Tunesmith, click **⚙ Settings**, paste the key and click **Save key**.

How the key is handled:
- It is encrypted with your system's keychain and is only ever sent to Anthropic.
- Requests use Claude Opus 5.5 and are billed to your Anthropic account.
- If Claude declines a request, a fallback model answers automatically (server-side fallback).

Alternatively, set the `ANTHROPIC_API_KEY` environment variable before `npm start`.

## How it works

| File | What it does |
|---|---|
| `app/theory.js` | Note and chord names (parses "C minor", "Bbm7", "F# sus4"…), key detection (Krumhansl–Kessler profiles), harmonising a melody (Viterbi search over the key's chords, scoring chord tones on strong beats and natural chord moves), next-chord and progression suggestions. |
| `app/audio.js` | The instruments, built with the Web Audio API: additive, FM, Karplus–Strong strings and formant synthesis, plus reverb. |
| `app/pitch.js` | Microphone pitch detection (YIN) and turning a stream of pitches into notes. |
| `app/generator.js` | The built-in idea engine: continues a melody using its own rhythms and intervals, variations, richer chords. |
| `app/midi.js` | Standard MIDI file export. |
| `app/main.js` | The interface. |
| `electron/` | The desktop shell: the window, microphone and MIDI permissions, encrypted key storage, file dialogs, and the Claude request (`claude.mjs`, structured JSON output). |

Run the tests with `npm test`.
