# Universal Breakbeat Phreaker (Prototype)

## Goal
- Create and explore rythms

## Screnshot
<img width="600" alt="screenshot" src="https://user-images.githubusercontent.com/26150152/224183606-46d27898-1b65-42d2-b68f-287b1c64ce26.png">

## Demo
[https://phreaker.vercel.app](https://phreaker.vercel.app)

## Install
```
npm i
npm run dev
```

## Onset Detection
- [https://github.com/aubio/aubio](https://github.com/aubio/aubio)
- command used to process a directory of .wav files:

```
for x in ./*.wav ; do mkdir "${x%.*}" && cp "$x" "${x%.*}/audio.wav" && aubioonset -i "${x%.*}/audio.wav" > "${x%.*}/times.txt" ;done
```
