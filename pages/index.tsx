import Head from "next/head";
import Image from "next/image";
import styles from "@/styles/Home.module.css";
import { promises as fs } from "fs";
import path from "path";
import { useCallback, useEffect, useRef, useState } from "react";

import * as Tone from "tone";
//@ts-ignore
import util from "audio-buffer-utils";
//@ts-ignore
import toWav from "audiobuffer-to-wav";

let init = false;

let wavesurfer: any;
let regionLoop: any;
let regionSel: any;
let touchMoved = false;

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

const arrShuffle = (a: any[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export default function Home(props: { folders: string[] }) {
  const [selectedFile, setSelectedFile] = useState("");
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const workerRef = useRef<Worker>();

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
        cursorColor: "#FF10F0",
        fillParent: false,
        scrollParent: false,
        plugins: [
          regions.create({
            regionsMinLength: 0.01,
            regions: [],
          }),
          markers.create({
            markers: [],
          }),
        ],
      });

      window.addEventListener("resize", (event) => {
        const zoomEle = document.querySelector("#zoom") as HTMLInputElement;
        if (zoomEle) {
          const minZoom = Math.floor(
            window.innerWidth / wavesurfer.getDuration()
          );
          wavesurfer.zoom(minZoom);
          zoomEle.min = minZoom.toString();
          zoomEle.value = minZoom.toString();
          setZoom(minZoom);
        }
        wavesurfer.drawer.fireEvent("redraw");
      });

      document.body.addEventListener("touchmove", (event) => {
        touchMoved = true;
      });

      wavesurfer.on("zoom", (val: number) => {
        const scrollEle = document.querySelector("#scroll") as HTMLInputElement;
        const waveEle = document.querySelector("#waveform") as HTMLDivElement;

        if (scrollEle && waveEle) {
          const scrollMax = waveEle.scrollWidth - window.innerWidth;

          if (scrollMax <= parseInt(scrollEle.value)) {
            scrollEle.value = scrollMax.toString();
            setScroll(scrollMax);
          }

          scrollEle.max = scrollMax.toString();
        }
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

        if (region.id === "loop") {
          Tone.Transport.setLoopPoints(snapStart / speed, snapEnd / speed);
        }

        region.update({
          start: snapStart,
          end: snapEnd,
        });
      });

      wavesurfer.on("ready", () => {
        wavesurfer.setVolume(0);

        if (!regionSel) {
          wavesurfer.addRegion({
            id: "selection",
            start: 0,
            end: seq[seq.length - 1].time + seq[seq.length - 1].duration,
            loop: false,
          });
          regionSel = Object.values(wavesurfer.regions.list)[0];
        }

        if (!regionLoop) {
          wavesurfer.addRegion({
            id: "loop",
            start: 0,
            end: seq[seq.length - 1].time + seq[seq.length - 1].duration,
            loop: true,
          });

          regionLoop = Object.values(wavesurfer.regions.list)[1];
          regionLoop.on("out", (e: any) => {
            if (wavesurfer.getCurrentTime() > regionLoop.end) {
              wavesurfer.play(regionLoop.start);
            }
          });

          const zoomEle = document.querySelector("#zoom") as HTMLInputElement;
          if (zoomEle) {
            const minZoom = Math.floor(
              window.innerWidth / wavesurfer.getDuration()
            );
            wavesurfer.zoom(minZoom);
            zoomEle.min = minZoom.toString();
            zoomEle.value = minZoom.toString();
            setZoom(minZoom);
          }
        } else {
          wavesurfer.seekTo(
            Tone.Time(Tone.Transport.position).toSeconds() /
              wavesurfer.getDuration()
          );
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
    wavesurfer.clearRegions();
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
    regionLoop = undefined;
    regionSel = undefined;
    resetWaveSurfer();

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

        const origBuffer = new Tone.Buffer(`/drums/${folder}/audio.wav`, () => {
          const buff = origBuffer.get();

          if (buff) {
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
                if (regionLoop) {
                  const firstPiece = seq.find(
                    (s) => s.time === regionLoop.start
                  );
                  if (value.idx === firstPiece?.idx) {
                    wavesurfer.play(regionLoop.start);
                  }
                }
              }, time);
            }, seq).start(0);

            wavesurfer.loadDecodedBuffer(buff);
          }
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
    e.preventDefault();
    e.stopPropagation();

    const startIdx = seq.findIndex((s) => s.time === regionSel.start);
    let endIdx = seq.findIndex((s) => s.time === regionSel.end);
    if (endIdx === -1) {
      endIdx = seq.length;
    }

    const shuffled = arrShuffle(seq.slice(startIdx, endIdx));
    seq.splice(startIdx, shuffled.length, ...shuffled);

    let durTotal = 0;

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
      return ret;
    });

    const times = seq.map((s) => s.time);
    times.push(seq[seq.length - 1].time + seq[seq.length - 1].duration);

    const snapStart = closest(times, regionLoop.start);
    const snapEnd = closest(times, regionLoop.end);

    Tone.Transport.setLoopPoints(snapStart / speed, snapEnd / speed);
    regionLoop.update({
      start: snapStart,
      end: snapEnd,
    });

    concatBuffers();
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
      wavesurfer.seekTo(regionLoop.start / wavesurfer.getDuration());
    } else {
      Tone.Transport.start("+0.5", regionLoop.start / speed);
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

    const handle = pos === "start" ? regionLoop.start : regionLoop.end;
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
      (pos === "start" && newPos < regionLoop.end) ||
      (pos === "end" && newPos > regionLoop.start)
    ) {
      const start = pos === "start" ? newPos : regionLoop.start;
      const end = pos === "end" ? newPos : regionLoop.end;

      Tone.Transport.setLoopPoints(start / speed, end / speed);
      regionLoop.update({
        start: start,
        end: end,
      });
    }
  };

  const changeSpeed = (val: number) => {
    part.playbackRate = val;
    players.forEach((p: any) => (p.playbackRate = val));

    Tone.Transport.setLoopPoints(regionLoop.start / val, regionLoop.end / val);

    wavesurfer.setPlaybackRate(val);
    setSpeed(val);
  };

  const changeZoom = (val: number) => {
    wavesurfer.zoom(val);
    setZoom(val);
  };

  useEffect(() => {
    // worker used to draw waveform after randomization
    workerRef.current = new Worker(
      new URL("../concatBuffers.js", import.meta.url)
    );
    workerRef.current.onmessage = (e: MessageEvent<any[]>) => {
      wavesurfer.loadDecodedBuffer(util.create(e.data));
    };
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const concatBuffers = useCallback(async () => {
    workerRef.current?.postMessage(
      seq.map((obj) => players[obj.idx].buffer.toArray())
    );
  }, []);

  return (
    <>
      <Head>
        <title>Universal BreakBeat Phreaker</title>
        <meta name="description" content="universal breakbeat phreaker" />
        <meta
          name="viewport"
          content="width=device-width, height=device-height, initial-scale=1, user-scalable=no"
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className={styles.main}>
        <h1 className={styles.title}>Universal BreakBeat Phreaker</h1>

        <div id="waveform" className={styles.waveform} />

        <input
          id="scroll"
          type="range"
          min={0}
          max={100}
          value={scroll}
          step={1}
          className={styles.slider}
          onInput={(e: React.ChangeEvent<HTMLInputElement>) => {
            const val = parseInt(e.target.value);
            const container = document.querySelector(
              "#waveform"
            ) as HTMLDivElement;

            if (container) {
              container.scrollLeft = val;
            }

            setScroll(val);
          }}
          disabled={
            loading ||
            zoom === Math.floor(window.innerWidth / wavesurfer?.getDuration())
          }
        />

        <input
          id="zoom"
          type="range"
          step={10}
          min={0}
          max={300}
          value={zoom}
          className={styles.slider}
          onInput={(e: React.ChangeEvent<HTMLInputElement>) => {
            changeZoom(parseInt(e.target.value));
          }}
          disabled={loading}
        />

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
