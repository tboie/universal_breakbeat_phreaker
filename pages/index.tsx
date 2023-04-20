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

import data from "../public/data.json";

let init = false;

let ws0: any;
let ws1: any;
let ws2: any;

let regionLoop: any;
let regionRand: any;
let regionLayer1: any;
let regionLayer2: any;

let touchMoved = false;

let players0: Tone.Player[] = [];
let players1: Tone.Player[] = [];
let players2: Tone.Player[] = [];

let part: Tone.Part;

type TSeq = {
  idx: number;
  time: number; // TODO: verify 6 decimal standard throughout
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

const table: any[] = [];
(data as any[]).forEach((b) => {
  b.c.forEach((v: any, i: any) => {
    const row = { n: b.n, i: i + 1, d: v[0], f: v[1] };
    table.push(row);
  });
});

export default function Home(props: { folders: string[] }) {
  const [selectedFile, setSelectedFile] = useState("");
  const [selectedLayer, setSelectedLayer] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [fader, setFader] = useState(0);
  const [layer2Volume, setLayer2Volume] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  //const workerRef = useRef<Worker>();

  useEffect(() => {
    const initWaveSurfer = async () => {
      const WaveSurfer = (await import("wavesurfer.js")).default;
      const regions =
        //@ts-ignore
        (await import("wavesurfer.js/dist/plugin/wavesurfer.regions")).default;
      const markers =
        //@ts-ignore
        (await import("wavesurfer.js/dist/plugin/wavesurfer.markers")).default;

      ws0 = WaveSurfer.create({
        container: "#waveform0",
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

      ws1 = WaveSurfer.create({
        container: "#waveform1",
        height: 200,
        waveColor: "gold",
        fillParent: false,
        scrollParent: false,
      });

      ws2 = WaveSurfer.create({
        container: "#waveform2",
        height: 200,
        waveColor: "teal",
        fillParent: false,
        scrollParent: false,
      });

      const configZoom = () => {
        const zoomEle = document.querySelector("#zoom") as HTMLInputElement;
        if (zoomEle) {
          const minZoom = Math.floor(window.innerWidth / ws0.getDuration());
          // 2 seconds max
          const maxZoom = Math.floor(window.innerWidth / 2);

          ws0.zoom(minZoom);
          ws1.zoom(minZoom);
          ws2.zoom(minZoom);
          zoomEle.min = minZoom.toString();
          zoomEle.max = maxZoom.toString();
          zoomEle.value = minZoom.toString();

          setZoom(minZoom);
        }
      };

      const configScroll = () => {
        const scrollEle = document.querySelector("#scroll") as HTMLInputElement;
        const waveEle = document.querySelector("#waveform0") as HTMLDivElement;

        if (scrollEle && waveEle) {
          const scrollMax = waveEle.scrollWidth - window.innerWidth;

          if (scrollMax <= parseInt(scrollEle.value)) {
            scrollEle.value = scrollMax.toString();
            setScroll(scrollMax);
          }

          scrollEle.max = scrollMax.toString();
        }
      };

      window.addEventListener("resize", (event) => {
        configScroll();
        configZoom();
        ws0.drawer.fireEvent("redraw");
        ws1.drawer.fireEvent("redraw");
        ws2.drawer.fireEvent("redraw");
      });

      document.body.addEventListener("touchmove", (event) => {
        touchMoved = true;
      });

      ws0.on("zoom", (val: number) => {
        configScroll();
      });

      ws0.on("region-update-end", (region: any) => {
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

      ws0.on("ready", () => {
        ws0.setVolume(0);

        if (!regionRand) {
          ws0.addRegion({
            id: "selection",
            start: 0,
            end: seq[seq.length - 1].time + seq[seq.length - 1].duration,
            loop: false,
          });
          regionRand = Object.values(ws0.regions.list)[0];
        }

        if (!regionLoop) {
          ws0.addRegion({
            id: "loop",
            start: 0,
            end: seq[seq.length - 1].time + seq[seq.length - 1].duration,
            loop: true,
          });

          regionLoop = Object.values(ws0.regions.list)[1];
          regionLoop.on("out", (e: any) => {
            if (ws0.getCurrentTime() > regionLoop.end) {
              ws0.play(regionLoop.start);
            }
          });

          configZoom();
        } else {
          // sets playhead on randomize
          ws0.seekTo(
            Tone.Time(Tone.Transport.position).toSeconds() / ws0.getDuration()
          );
        }

        if (!regionLayer1) {
          ws0.addRegion({
            id: "layer1",
            start: 0,
            end: seq[seq.length - 1].time + seq[seq.length - 1].duration,
            loop: false,
          });
          regionLayer1 = Object.values(ws0.regions.list)[2];
        }

        if (!regionLayer2) {
          ws0.addRegion({
            id: "layer2",
            start: 0,
            end: seq[seq.length - 1].time + seq[seq.length - 1].duration,
            loop: false,
          });
          regionLayer2 = Object.values(ws0.regions.list)[3];
        }

        ws0.clearMarkers();
        seq.forEach((s) => {
          ws0.addMarker({ time: s.time });
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
    regionLoop = undefined;
    regionRand = undefined;
    regionLayer1 = undefined;
    regionLayer2 = undefined;

    ws0.stop();
    ws0.clearRegions();
    ws0.clearMarkers();
    ws0.setPlaybackRate(1);
    ws0.zoom(0);
    ws0.empty();

    ws1.zoom(0);
    ws1.empty();
    ws1.backend.buffer = undefined;

    ws2.zoom(0);
    ws2.empty();
    ws2.backend.buffer = undefined;
  };

  const listClick = async (
    e: React.MouseEvent<HTMLLIElement, MouseEvent> | undefined,
    folder: string
  ) => {
    e?.preventDefault();
    e?.stopPropagation();

    resetWaveSurfer();

    let times: any[] = [];
    await fetch(`/drums/${folder}/times.txt`)
      .then((response) => response.text())
      .then((text) => {
        times = text
          .split("\n")
          .filter((t) => t)
          .map((t) => parseFloat(t));
      });

    const temp: any[] = [];
    await Promise.all(
      times.map(async (t: number, idx: number) => {
        await fetch(`/drums/${folder}/${idx + 1}.wav`)
          .then(async (response) => {
            return await response.arrayBuffer();
          })
          .then(async (arrayBuffer) => {
            const buff = await Tone.context.decodeAudioData(arrayBuffer);
            temp.push({ i: idx, t: t, buff: buff });
          })
          .catch((error) => {
            throw Error(`Asset failed to load: ${error.message}`);
          });
      })
    );

    temp.sort((a, b) => a.i - b.i);

    players0.forEach((p: any) => p.dispose());
    players0 = [];

    players1.forEach((p: any) => p.dispose());
    players1 = [];

    players2.forEach((p: any) => p.dispose());
    players2 = [];

    seq = [];

    temp.forEach((o) => {
      players0.push(new Tone.Player(o.buff).toDestination());
      seq.push({
        idx: o.i,
        time: o.t,
        duration: parseFloat(o.buff.duration.toFixed(6)),
      });
    });

    const end = seq[seq.length - 1].time + seq[seq.length - 1].duration;
    Tone.Transport.setLoopPoints(0, end);
    Tone.Transport.loop = true;

    part?.dispose();
    part = new Tone.Part((time, value) => {
      players0[value.idx]?.start(time);

      players1[value.idx]?.start(time);

      /* trim overlapping pieces
      players1[value.idx]?.stop(
        Tone.Time(time).toSeconds() + Tone.Time(value.duration).toSeconds()
      );
      */

      players2[value.idx]?.start(time);

      // start playhead at piece
      Tone.Draw.schedule(() => {
        if (regionLoop) {
          const piece = seq.find((s) => s.idx === value.idx);
          if (piece) {
            ws0.play(piece.time);
          }
        }
      }, time);
    }, seq).start(0);

    Tone.Transport.position = "0:0:0";

    //concatBuffers();
    await drawLayer(0);

    setSpeed(1);
    setZoom(0);
    setFader(0);
    setSelectedFile(folder);
    setLoading(true);
    setSelectedLayer(0);
  };

  const originalClick = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    listClick(undefined, selectedFile);
  };

  const randomClick = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const startIdx = seq.findIndex((s) => s.time === regionRand.start);
    let endIdx = seq.findIndex((s) => s.time === regionRand.end);
    if (endIdx === -1) {
      endIdx = seq.length;
    }

    const shuffled = arrShuffle(seq.slice(startIdx, endIdx));
    seq.splice(startIdx, shuffled.length, ...shuffled);

    let durTotal = 0;

    // could notes be scheduled more precisely to avoid dropouts?
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

    await drawLayer(0);
    await drawLayer(1);
    await drawLayer(2);

    //concatBuffers();
  };

  const downloadClick = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const wav = toWav(ws0.backend.buffer);
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
      ws0.pause();
      ws0.seekTo(regionLoop.start / ws0.getDuration());
    } else {
      Tone.Transport.start("+0.5", regionLoop.start / speed);
    }

    setPlaying(!playing);
  };

  const resizeRegion = (
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

    players0.forEach((p: any) => (p.playbackRate = val));
    players1.forEach((p: any) => (p.playbackRate = val));

    Tone.Transport.setLoopPoints(regionLoop.start / val, regionLoop.end / val);
    ws0.setPlaybackRate(val);
    setSpeed(val);
  };

  const changeZoom = (val: number) => {
    ws0.zoom(val);
    ws1.zoom(val);
    ws2.zoom(val);
    setZoom(val);
  };

  const changeFader = (val: number) => {
    if (val < 0) {
      players1.forEach((p) => {
        p.set({
          volume: val,
        });
      });
      players0.forEach((p) => {
        p.set({
          volume: 0,
        });
      });
    } else if (val > 0) {
      players0.forEach((p) => {
        p.set({
          volume: val * -1,
        });
      });
      players1.forEach((p) => {
        p.set({
          volume: 0,
        });
      });
    }

    setFader(val);
  };

  const changeLayer2Volume = (val: number) => {
    players2.forEach((p) => {
      p.set({
        volume: val,
      });
    });
    setLayer2Volume(val);
  };

  /*
  useEffect(() => {
    // worker used to concat waveform after randomization
    workerRef.current = new Worker(
      new URL("../concatBuffers.js", import.meta.url)
    );
    workerRef.current.onmessage = (e: MessageEvent<any>) => {
      ws0.loadDecodedBuffer(util.create(e.data));
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
  */

  const findMatches = async (layer: number) => {
    let srcTable: any[] = [];
    srcTable = table.filter((r) => r.n === selectedFile);
    // all pieces
    // srcTable = table.filter((r) => r.n !== selectedFile);

    const selTable = table.filter(
      (r) =>
        r.n === props.folders[Math.floor(Math.random() * props.folders.length)]
    );

    const matches: any = [];
    srcTable.forEach((src) => {
      const t = selTable.map((r) => {
        const freqDiff = Math.abs(r.f - src.f);
        const durDiff = Math.abs(r.d - src.d);
        return { ...r, fDiff: freqDiff, dDiff: durDiff };
      });

      t.sort((a, b) => a.dDiff - b.dDiff || a.fDiff - b.fDiff);

      const r = Math.floor(Math.random() * 3);
      matches.push(t[r]);
    });

    const t_players: any[] = [];
    await Promise.all(
      matches.map(async (m: any, idx: number) => {
        await fetch(`/drums/${m.n}/${m.i}.wav`)
          .then(async (response) => {
            return await response.arrayBuffer();
          })
          .then(async (arrayBuffer) => {
            const buff = await Tone.context.decodeAudioData(arrayBuffer);
            t_players.push({
              i: idx,
              o: new Tone.Player(buff).toDestination(),
            });
          })
          .catch((error) => {
            throw Error(`Asset failed to load: ${error.message}`);
          });
      })
    );

    t_players.sort((a, b) => a.i - b.i);

    if (layer === 1) {
      players1.forEach((p) => p.dispose());
      players1 = t_players.map((r) => r.o);
    } else if (layer === 2) {
      players2.forEach((p) => p.dispose());
      players2 = t_players.map((r) => r.o);
    }

    await drawLayer(layer);
  };

  const drawLayer = async (layer: number) => {
    const duration = seq[seq.length - 1].time + seq[seq.length - 1].duration;

    Tone.Offline(({ transport }) => {
      let c_players: Tone.Player[] = [];

      if (layer === 0) {
        c_players = players0.map((p) =>
          new Tone.Player(p.buffer.get()).toDestination()
        );
        c_players.forEach((p, idx) => {
          p.set({ mute: players0[idx].mute });
        });
      } else if (layer === 1) {
        c_players = players1.map((p) =>
          new Tone.Player(p.buffer.get()).toDestination()
        );
        c_players.forEach((p, idx) => {
          p.set({ mute: players1[idx].mute });
        });
      } else if (layer === 2) {
        c_players = players2.map((p) =>
          new Tone.Player(p.buffer.get()).toDestination()
        );
        c_players.forEach((p, idx) => {
          p.set({ mute: players2[idx].mute });
        });
      }

      new Tone.Part((time, value) => {
        c_players[value.idx]?.start(time);
      }, seq).start(0);

      transport.start(0);
    }, duration).then((buffer) => {
      if (layer === 0) {
        ws0.loadDecodedBuffer(buffer.get());
      } else if (layer === 1) {
        ws1.loadDecodedBuffer(buffer.get());
      } else if (layer === 2) {
        ws2.loadDecodedBuffer(buffer.get());
      }
    });
  };

  const layerClick = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number
  ) => {
    e.stopPropagation();
    e.preventDefault();

    if (layer !== selectedLayer) {
      await drawLayer(layer === 2 ? 1 : 2);
      await drawLayer(layer);
      setSelectedLayer(layer);
    } else {
      await drawLayer(1);
      await drawLayer(2);
      setSelectedLayer(0);
    }
  };

  const erase = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number
  ) => {
    e.stopPropagation();
    e.preventDefault();

    if (layer === 0) {
      seq.forEach((n) => {
        if (n.time >= regionRand.start && n.time < regionRand.end) {
          players0[n.idx]?.set({
            mute: Math.round(Math.random()) ? true : false,
          });
        }
      });
    } else if (layer === 1) {
      seq.forEach((n) => {
        if (n.time >= regionLayer1.start && n.time < regionLayer1.end) {
          players1[n.idx]?.set({
            mute: Math.round(Math.random()) ? true : false,
          });
        }
      });
    } else if (layer === 2) {
      seq.forEach((n) => {
        if (n.time >= regionLayer2.start && n.time < regionLayer2.end) {
          players2[n.idx]?.set({
            mute: Math.round(Math.random()) ? true : false,
          });
        }
      });
    }

    drawLayer(layer);
  };
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

        <div id="waveform0" className={`layer${selectedLayer}`} />
        <div id="waveform1" />
        <div id="waveform2" />

        <div className={styles.controls}>
          <button
            onClick={(e) => resizeRegion(e, "start", "left")}
            disabled={loading}
          >
            {"<"}
          </button>
          <button
            onClick={(e) => resizeRegion(e, "start", "right")}
            disabled={loading}
          >
            {">"}
          </button>
          <span className={styles.info}>{speed + "x"}</span>
          <button
            onClick={(e) => resizeRegion(e, "end", "left")}
            disabled={loading}
          >
            {"<"}
          </button>
          <button
            onClick={(e) => resizeRegion(e, "end", "right")}
            disabled={loading}
          >
            {">"}
          </button>
        </div>

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

            ["#waveform0", "#waveform1", "#waveform2"].forEach((n) => {
              const container = document.querySelector(n) as HTMLDivElement;

              if (container) {
                container.scrollLeft = val;
              }
            });

            setScroll(val);
          }}
          disabled={
            loading ||
            zoom === Math.floor(window.innerWidth / ws0?.getDuration())
          }
        />
        <input
          id="zoom"
          type="range"
          step={10}
          min={0}
          max={100}
          value={zoom}
          className={styles.slider}
          onInput={(e: React.ChangeEvent<HTMLInputElement>) => {
            changeZoom(parseInt(e.target.value));
          }}
          disabled={
            loading ||
            parseInt(
              (document.querySelector("#zoom") as HTMLInputElement)?.min
            ) >=
              parseInt(
                (document.querySelector("#zoom") as HTMLInputElement)?.max
              )
          }
        />
        <input
          id="speed"
          type="range"
          min={0.05}
          max={2}
          value={speed}
          step={0.05}
          className={styles.slider}
          onInput={(e: React.ChangeEvent<HTMLInputElement>) => {
            changeSpeed(parseFloat(e.target.value));
          }}
          disabled={loading}
        />
        <input
          id="fader"
          type="range"
          min={-20}
          max={20}
          value={fader}
          step={0.1}
          className={styles.slider}
          onInput={(e: React.ChangeEvent<HTMLInputElement>) => {
            changeFader(parseFloat(e.target.value));
          }}
          disabled={loading}
        />
        <input
          id="layer2Volume"
          type="range"
          min={-20}
          max={0}
          value={layer2Volume}
          step={0.1}
          className={styles.slider}
          onInput={(e: React.ChangeEvent<HTMLInputElement>) => {
            changeLayer2Volume(parseFloat(e.target.value));
          }}
          disabled={loading}
        />

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

        <div className={styles.toolbar}>
          <button
            className={selectedLayer === 1 ? styles.selected : ""}
            onClick={(e) => layerClick(e, 1)}
            disabled={loading}
          >
            1
          </button>

          <button
            className={selectedLayer === 2 ? styles.selected : ""}
            onClick={(e) => layerClick(e, 2)}
            disabled={loading}
          >
            2
          </button>

          <button
            disabled={loading || selectedLayer === 0}
            onClick={() => findMatches(selectedLayer)}
          >
            Match
          </button>

          <button onClick={(e) => erase(e, selectedLayer)} disabled={loading}>
            Erase
          </button>
        </div>
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
