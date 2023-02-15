import Head from "next/head";
import Image from "next/image";
import styles from "@/styles/Home.module.css";
import { promises as fs } from "fs";
import path from "path";
import { useEffect, useState } from "react";
//@ts-ignore
import util from "audio-buffer-utils";
//@ts-ignore
import toWav from "audiobuffer-to-wav";

let wavesurfer: any;
let init = false;
let times: string[] = [];
let audio: any;
let finalAudio: any;
let wav: any;
let blob: Blob;
let blobUrl = "";
let selectedFolder = "";

export default function Home(props: any) {
  const [selectedFile, setSelectedFile] = useState("");
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const initWaveSurfer = async () => {
      const WaveSurfer = (await import("wavesurfer.js")).default;
      const regions =
        //@ts-ignore
        (await import("wavesurfer.js/dist/plugin/wavesurfer.regions")).default;
      const markers =
        //@ts-ignore
        (await import("wavesurfer.js/dist/plugin/wavesurfer.markers")).default;

      wavesurfer = WaveSurfer.create({
        container: "#waveform",
        height: 200,
        waveColor: "#39FF14",
        progressColor: "darkgreen",
        plugins: [
          regions.create({
            regionsMinLength: 0.1,
            regions: [],
          }),
          markers.create({
            markers: [],
          }),
        ],
      });

      wavesurfer.on("ready", function () {
        wavesurfer.clearRegions();
        wavesurfer.addRegion({
          start: 0,
          end: wavesurfer.getDuration(),
          loop: true,
          color: "rgba(255, 215, 0, 0.15)",
        });
        finalAudio = wavesurfer.backend.buffer;
        times.forEach((t) => {
          wavesurfer.addMarker({ time: t });
        });
        setSelectedFile(selectedFolder);
      });
    };

    if (!init) {
      init = true;
      initWaveSurfer();
      window.addEventListener("resize", (event) => {
        wavesurfer.drawer.fireEvent("redraw");
      });
    }
  }, []);

  const listClick = (folder: string) => {
    fetch(`/drums/${folder}/times.txt`)
      .then((response) => response.text())
      .then((text) => {
        selectedFolder = folder;
        times = text.split("\n");
        wavesurfer.clearMarkers();
        wavesurfer.load(`/drums/${folder}/audio.wav`);
        wavesurfer.setPlaybackRate(1);
        setSpeed(1);
        setSelectedFile("");
      });
  };

  const originalClick = () => {
    wavesurfer.load(`/drums/${selectedFile}/audio.wav`);
    wavesurfer.setPlaybackRate(1);
    setSpeed(1);
  };

  const randomClick = async () => {
    function arrShuffle(a: any[]) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    const ctx = new AudioContext();
    times = [];
    audio = util.create();
    finalAudio = util.create();

    fetch(`/drums/${selectedFile}/times.txt`)
      .then((response) => response.text())
      .then((text) => {
        times = text.split("\n");

        fetch(`/drums/${selectedFile}/audio.wav`)
          .then((data) => data.arrayBuffer())
          .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer))
          .then(async (decodedAudio) => {
            audio = decodedAudio;

            const buffers = times.map((t, idx) => {
              if (idx < times.length) {
                return {
                  buffer: util.slice(
                    audio,
                    audio.sampleRate * parseFloat(t),
                    audio.sampleRate * parseFloat(times[idx + 1])
                  ),
                  duration: parseFloat(times[idx + 1]) - parseFloat(t),
                };
              }
            });

            const shuffled = arrShuffle(buffers);
            shuffled.forEach((b, idx) => {
              if (b) {
                finalAudio = util.concat(finalAudio, b.buffer);
              }
            });

            let durTotal = 0;
            times = shuffled.map((obj: any, idx) => {
              if (obj && obj.duration) {
                durTotal += obj.duration;
              }
              return durTotal.toString();
            });

            wav = toWav(finalAudio);
            blob = new window.Blob([new DataView(wav)], {
              type: "audio/wav",
            });

            wavesurfer.clearMarkers();
            wavesurfer.clearRegions();
            wavesurfer.loadBlob(blob);
            wavesurfer.addRegion({
              start: 0,
              end: wavesurfer.getDuration(),
              loop: true,
              color: "rgba(255, 215, 0, 0.15)",
            });
          });
      });
  };

  const downloadClick = () => {
    const anchor = document.createElement("a");
    wav = toWav(finalAudio);
    blob = new window.Blob([new DataView(wav)], {
      type: "audio/wav",
    });
    blobUrl = window.URL.createObjectURL(blob);
    anchor.href = blobUrl;
    anchor.download = "audio.wav";
    anchor.click();
    window.URL.revokeObjectURL(blobUrl);
  };

  return (
    <>
      <Head>
        <title>Universal BreakBeat Phreaker</title>
        <meta name="description" content="Generated by create next app" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className={styles.main}>
        <span className={styles.title}>Universal BreakBeat Phreaker</span>

        <div id="waveform" className={styles.waveform} />

        <span className={styles.info}>
          {`${selectedFile} ${selectedFile ? `[speed: ${speed}]` : ""}`}
        </span>

        <input
          type="range"
          min="0.05"
          max="2"
          value={speed}
          step="0.05"
          className={styles.slider}
          onInput={(e: any) => {
            const speed = e.target.value as number;
            setSpeed(speed);
            wavesurfer.setPlaybackRate(speed);
          }}
          disabled={!!!selectedFile}
        />

        <div className={styles.toolbar}>
          <button onClick={originalClick} disabled={!!!selectedFile}>
            Original
          </button>

          <button
            disabled={!!!selectedFile}
            onClick={() =>
              wavesurfer.isPlaying()
                ? wavesurfer.pause()
                : (Object.values(wavesurfer.regions.list)[0] as any).playLoop()
            }
          >
            Play/Pause
          </button>

          <button onClick={randomClick} disabled={!!!selectedFile}>
            <Image
              src={!!!selectedFile ? "dice_disabled.svg" : "dice.svg"}
              alt="dice"
              width={24}
              height={24}
            />
          </button>

          <button
            id="download"
            onClick={downloadClick}
            disabled={!!!selectedFile}
          >
            Download
          </button>
        </div>

        <ul className={styles.playlist}>
          {props.folders.map((folder: string) => {
            return (
              <li
                className={folder === selectedFile ? styles.selected : ""}
                key={folder}
                onClick={() => listClick(folder)}
              >
                {folder}
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}

export async function getStaticProps() {
  const drumsDir = path.join(process.cwd(), "public/drums");
  const folders = await fs.readdir(drumsDir);

  return {
    props: {
      folders: await Promise.all(folders),
    },
  };
}
