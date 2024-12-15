# Universal Breakbeat Phreaker

## Goal

- Create and explore rhythms and sounds

## Screenshot
![bb phreaker screenshot](https://github.com/user-attachments/assets/d00df33e-7dcd-4844-bbab-234d452aac5b)

## Audio Data Generation Scripts

[public/scripts](https://github.com/tboie/universal_breakbeat_phreaker/tree/main/public/scripts)

How to generate:

- create folder
- add above scripts
- add .wav audio files
- configure proc_audio.sh (more info in file)
- run `./proc_audio.sh`
- move generated folders and data.json to pallet number in public/pallets

## Demo

[https://phreaker.vercel.app](https://phreaker.vercel.app)

## Install

```
npm i
npm run dev
```

## Onset Detection

- [https://github.com/aubio/aubio](https://github.com/aubio/aubio)
