# Universal Breakbeat Phreaker (Prototype)

## Goal
- Create and explore rythms

## Screenshot
<img width="600" alt="screen" src="https://user-images.githubusercontent.com/26150152/224182403-1870bffd-1aa8-419a-8adb-ff82b769b04f.png">

## Demo
[https://phreaker.vercel.app](https://phreaker.vercel.app)

## Install
```
npm i
npm run dev
```

## Onset Detection
- [aubio.org](https://aubio.org)
- command used to process a directory of .wav files:

```
for x in ./*.wav ; do mkdir "${x%.*}" && cp "$x" "${x%.*}/audio.wav" && aubioonset -i "${x%.*}/audio.wav" > "${x%.*}/times.txt" ;done
```
