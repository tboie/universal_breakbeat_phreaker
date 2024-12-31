# Universal Breakbeat Phreaker

## Goal

- Create and explore rhythms and sounds

## Screenshot

![bb phreaker screenshot](https://github.com/user-attachments/assets/d00df33e-7dcd-4844-bbab-234d452aac5b)

## Demo

[https://phreaker.vercel.app](https://phreaker.vercel.app)

## Install

```
npm i
npm run dev
```

## Conceptual Notes for Later

<img width="546" alt="conceptual diagram" src="https://github.com/user-attachments/assets/6cbccaa3-ca52-4734-8200-8c56b656ffc3" />

Audio Script Workflow:

1. cut audio file into 30 second segments
2. cut onsets of all segments
3. get freq data of all onsets
4. get avg freq of onsets and duration
5. rename onset files to index numbers

## Audio Data Generation Scripts

[public/scripts](https://github.com/tboie/universal_breakbeat_phreaker/tree/main/public/scripts)

How to generate:

- create folder
- add above scripts
- add .wav audio files
- configure [proc_audio.sh](https://github.com/tboie/universal_breakbeat_phreaker/tree/main/public/scripts/proc_audio.sh)
- run `./proc_audio.sh`
- move generated folders and data.json to pallet number in public/pallets

## Onset Detection

- [https://github.com/aubio/aubio](https://github.com/aubio/aubio)
