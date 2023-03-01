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

import * as Tone from "tone";

let init = false;

let wavesurfer: any;
let region: any;
let touchMoved = false;

let origBuffer: any;
let players: any = [];
let part: any;

type TSeq = {
  idx: number;
  time: number;
  duration: number;
};

let seq: TSeq[] = [];

const closest = (array: number[], goal: number) =>
  array.reduce((prev, curr) =>
    Math.abs(curr - goal) < Math.abs(prev - goal) ? curr : prev
  );

export default function Home(props: { folders: string[] }) {
  const [selectedFile, setSelectedFile] = useState("");
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);

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
        progressColor: "#39FF14",
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

      window.addEventListener("resize", (event) => {
        wavesurfer.drawer.fireEvent("redraw");
      });

      document.body.addEventListener("touchmove", (event) => {
        touchMoved = true;
      });

      wavesurfer.on("region-update-end", (region: any) => {
        // fixes ignored first click after region resize on touch devices
        if (touchMoved) {
          document.body.click();
          touchMoved = false;
        }

        const times = seq.map((s) => s.time);
        times.push(seq[seq.length - 1].time + seq[seq.length - 1].duration);

        const snapStart = closest(times, region.start);
        const snapEnd = closest(times, region.end);
        const speed =
          parseFloat(
            (document.getElementById("speed") as HTMLInputElement).value
          ) || 1;

        Tone.Transport.setLoopPoints(snapStart / speed, snapEnd / speed);
        region.update({
          start: snapStart,
          end: snapEnd,
        });
      });

      wavesurfer.on("ready", function () {
        wavesurfer.setVolume(0);

        if (!region) {
          wavesurfer.clearRegions();
          wavesurfer.addRegion({
            start: 0,
            end: seq[seq.length - 1].time + seq[seq.length - 1].duration,
            loop: true,
            color: "rgba(255, 255, 255, 0.15)",
          });

          region = Object.values(wavesurfer.regions.list)[0];
          region.on("out", (e: any) => {
            if (wavesurfer.getCurrentTime() > region.end) {
              wavesurfer.play(region.start);
            }
          });
        }

        wavesurfer.clearMarkers();
        seq.forEach((s) => {
          wavesurfer.addMarker({ time: s.time });
        });

        setLoading(false);
      });
    };

    if (!init) {
      init = true;
      initWaveSurfer();
    }
  }, []);

  const resetWaveSurfer = () => {
    wavesurfer.stop();
    wavesurfer.clearMarkers();
    wavesurfer.setPlaybackRate(1);
    wavesurfer.zoom(0);
    wavesurfer.empty();

    setSpeed(1);
    setZoom(0);
    setPlaying(false);
  };

  const listClick = async (
    e: React.MouseEvent<HTMLLIElement, MouseEvent> | undefined,
    folder: string
  ) => {
    e?.preventDefault();
    e?.stopPropagation();

    Tone.Transport.stop();
    resetWaveSurfer();
    region = undefined;

    setSelectedFile(folder);
    setLoading(true);

    await fetch(`/drums/${folder}/times.txt`)
      .then((response) => response.text())
      .then((text) => {
        const times = text
          .split("\n")
          .filter((t) => t)
          .map((t) => parseFloat(t));

        players.forEach((p: any) => p.dispose());
        players = [];
        seq = [];

        origBuffer = new Tone.Buffer(`/drums/${folder}/audio.wav`, () => {
          const buff = origBuffer.get();

          times.forEach((t, idx) => {
            const dur =
              idx === times.length - 1
                ? parseFloat((buff.duration - t).toFixed(6))
                : parseFloat((times[idx + 1] - t).toFixed(6));

            const b = util.slice(
              buff,
              buff.sampleRate * t,
              buff.sampleRate * (t + dur)
            );
            players.push(new Tone.Player(b).toDestination());

            seq.push({
              idx: idx,
              time: t,
              duration: dur,
            });
          });

          const end = seq[seq.length - 1].time + seq[seq.length - 1].duration;
          Tone.Transport.setLoopPoints(0, end);
          Tone.Transport.loop = true;

          part?.dispose();
          part = new Tone.Part((time, value) => {
            players[value.idx]?.start(time);

            Tone.Draw.schedule(() => {
              const firstPiece = seq.find((s) => s.time === region.start);
              if (value.idx === firstPiece?.idx) {
                wavesurfer.play(region.start);
              }
            }, time);
          }, seq).start(0);

          wavesurfer.loadDecodedBuffer(buff);
        });
      });
  };

  const originalClick = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    listClick(undefined, selectedFile);
  };

  const randomClick = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    function arrShuffle(a: any[]) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    e.preventDefault();
    e.stopPropagation();

    setLoading(true);

    let finalAudio = util.create();
    let durTotal = 0;

    const startIdx = seq.findIndex((s) => s.time === region.start);
    let endIdx = seq.findIndex((s) => s.time === region.end);
    if (endIdx === -1) {
      endIdx = seq.length;
    }

    const shuffled = arrShuffle(seq.slice(startIdx, endIdx));
    seq.splice(startIdx, shuffled.length, ...shuffled);

    part.clear();
    seq = seq.map((obj, idx) => {
      if (idx) {
        durTotal += seq[idx - 1].duration;
      }

      const ret = {
        idx: obj.idx,
        time: parseFloat(durTotal.toFixed(6)),
        duration: obj.duration,
      };

      part.add(ret.time, { idx: ret.idx, duration: ret.duration });
      finalAudio = util.concat(finalAudio, players[obj.idx].buffer);

      return ret;
    });

    wavesurfer.loadDecodedBuffer(finalAudio);
  };

  const downloadClick = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const wav = toWav(wavesurfer.backend.buffer);
    const blob = new window.Blob([new DataView(wav)], {
      type: "audio/wav",
    });
    const blobUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;

    anchor.download = selectedFile + "_PHREAKED";
    anchor.click();
    window.URL.revokeObjectURL(blobUrl);
  };

  const playStopClick = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    await Tone.start();
    if (playing) {
      Tone.Transport.stop();
      wavesurfer.pause();
      wavesurfer.seekTo(region.start / wavesurfer.getDuration());
    } else {
      Tone.Transport.start(undefined, region.start / speed);
    }

    setPlaying(!playing);
  };

  const moveRegion = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    pos: "start" | "end",
    dir: "left" | "right"
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const times = seq.map((s) => s.time);
    times.push(seq[seq.length - 1].time + seq[seq.length - 1].duration);

    const handle = pos === "start" ? region.start : region.end;
    const result = closest(times, handle);
    let newPos = handle;

    if (dir === "left") {
      if (handle <= result) {
        if (handle > times[1]) {
          newPos = times[times.findIndex((t) => t === result) - 1];
        } else {
          if (pos === "start") {
            newPos = 0;
          }
        }
      } else {
        newPos = result;
      }
    } else if (dir === "right") {
      if (handle >= result) {
        if (handle < times[times.length - 2]) {
          newPos = times[times.findIndex((t) => t === result) + 1];
        } else {
          if (pos === "end") {
            newPos = times[times.length - 1];
          }
        }
      } else {
        newPos = result;
      }
    }

    if (
      (pos === "start" && newPos < region.end) ||
      (pos === "end" && newPos > region.start)
    ) {
      const start = pos === "start" ? newPos : region.start;
      const end = pos === "end" ? newPos : region.end;

      Tone.Transport.setLoopPoints(start / speed, end / speed);
      region.update({
        start: start,
        end: end,
      });
    }
  };

  const changeSpeed = (val: number) => {
    part.playbackRate = val;
    players.forEach((p: any) => (p.playbackRate = val));

    Tone.Transport.setLoopPoints(region.start / val, region.end / val);

    wavesurfer.setPlaybackRate(val);
    setSpeed(val);
  };

  const changeZoom = (val: number) => {
    wavesurfer.zoom(val);
    setZoom(val);
  };

  return (
    <>
      <Head>
        <title>Universal BreakBeat Phreaker</title>
        <meta name="description" content="Generated by create next app" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, user-scalable=no"
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className={styles.main}>
        <h1 className={styles.title}>Universal BreakBeat Phreaker</h1>

        <div id="waveform" className={styles.waveform} />

        <div className={styles.controls}>
          <button
            onClick={(e) => moveRegion(e, "start", "left")}
            disabled={loading}
          >
            {"<"}
          </button>
          <button
            onClick={(e) => moveRegion(e, "start", "right")}
            disabled={loading}
          >
            {">"}
          </button>
          <span className={styles.info}>{speed + "x"}</span>
          <button
            onClick={(e) => moveRegion(e, "end", "left")}
            disabled={loading}
          >
            {"<"}
          </button>
          <button
            onClick={(e) => moveRegion(e, "end", "right")}
            disabled={loading}
          >
            {">"}
          </button>
        </div>

        <input
          id="speed"
          type="range"
          min="0.05"
          max="2"
          value={speed}
          step="0.05"
          className={styles.slider}
          onInput={(e: React.ChangeEvent<HTMLInputElement>) => {
            changeSpeed(parseFloat(e.target.value));
          }}
          disabled={loading}
        />

        <input
          id="zoom"
          type="range"
          step={25}
          min={0}
          max={800}
          value={zoom}
          className={styles.slider}
          onInput={(e: React.ChangeEvent<HTMLInputElement>) => {
            changeZoom(parseInt(e.target.value));
          }}
          disabled={loading}
        />

        <div className={styles.toolbar}>
          <button onClick={(e) => originalClick(e)} disabled={loading}>
            Original
          </button>

          <button disabled={loading} onClick={(e) => playStopClick(e)}>
            {playing ? "Stop" : "Play"}
          </button>

          <button onClick={(e) => randomClick(e)} disabled={loading}>
            <Image
              src={loading ? "dice_disabled.svg" : "dice.svg"}
              alt="dice"
              width={24}
              height={24}
            />
          </button>

          <button
            id="download"
            onClick={(e) => downloadClick(e)}
            disabled={loading}
          >
            Download
          </button>
        </div>

        <ul className={styles.playlist}>
          {props.folders.map((folder) => {
            return (
              <li
                className={folder === selectedFile ? styles.selected : ""}
                key={folder}
                onClick={(e) => listClick(e, folder)}
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
