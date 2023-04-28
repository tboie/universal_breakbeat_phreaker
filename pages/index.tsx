import Head from "next/head";
import Image from "next/image";
import styles from "@/styles/Home.module.css";
import { promises as fs } from "fs";
import path from "path";
import { useEffect, useState } from "react";

import * as Tone from "tone";

//@ts-ignore
import toWav from "audiobuffer-to-wav";

import data from "../public/data.json";

let init = false;

let ws0: any;
let ws1: any;
let ws2: any;
let wsRegions: any;

let regionLoop: any;
let regionSelect: any;

let touchMoved = false;

type TBuffer = {
  name: string;
  cutIdx: number;
  layer: number;
  buffer: Tone.ToneAudioBuffer;
};

type TSeq = {
  layer: number;
  time: number; // TODO: verify 6 decimal standard throughout
  duration: number;
  player: Tone.Player;
  name: string;
  cutIdx: number;
};

type TPallet = {
  layer: number;
  sounds: any[];
};

let buffers: TBuffer[] = [];
let seq: TSeq[] = [];
let pallets: TPallet[] = [];

let part: Tone.Part;

// all pieces data table
const table: any[] = [];
(data as any[]).forEach((b) => {
  b.c.forEach((v: any, i: any) => {
    const row = { n: b.n, i: i + 1, d: v[0], f: v[1] };
    table.push(row);
  });
});

// utils
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
  const [selectedFolder, setSelectedFolder] = useState("");
  const [selectedLayer, setSelectedLayer] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [fader, setFader] = useState(0);
  const [layer2Volume, setLayer2Volume] = useState(0);
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

      ws0 = WaveSurfer.create({
        container: "#ws0",
        height: 200,
        waveColor: "#39FF14",
        fillParent: false,
        scrollParent: false,
      });

      ws1 = WaveSurfer.create({
        container: "#ws1",
        height: 200,
        waveColor: "gold",
        fillParent: false,
        scrollParent: false,
      });

      ws2 = WaveSurfer.create({
        container: "#ws2",
        height: 200,
        waveColor: "teal",
        fillParent: false,
        scrollParent: false,
      });

      wsRegions = WaveSurfer.create({
        container: "#wsRegions",
        height: 200,
        waveColor: "transparent",
        progressColor: "transparent",
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

      const configZoom = () => {
        const zoomEle = document.querySelector("#zoom") as HTMLInputElement;
        if (zoomEle) {
          const minZoom = Math.floor(
            window.innerWidth / wsRegions.getDuration()
          );
          // 2 seconds max
          const maxZoom = Math.floor(window.innerWidth / 2);

          wsRegions.zoom(minZoom);
          ws0.zoom(minZoom);
          ws1.zoom(minZoom);
          ws2.zoom(minZoom);
          zoomEle.min = minZoom.toString();
          zoomEle.max = maxZoom.toString();
          zoomEle.value = minZoom.toString();
          zoomEle.step = Math.floor(maxZoom / 6).toString();

          setZoom(minZoom);
        }
      };

      const configScroll = () => {
        const scrollEle = document.querySelector("#scroll") as HTMLInputElement;
        const waveEle = document.querySelector("#ws0") as HTMLDivElement;

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
        wsRegions.drawer.fireEvent("redraw");
        ws0.drawer.fireEvent("redraw");
        ws1.drawer.fireEvent("redraw");
        ws2.drawer.fireEvent("redraw");
      });

      document.body.addEventListener("touchmove", (event) => {
        touchMoved = true;
      });

      wsRegions.on("zoom", (val: number) => {
        configScroll();
      });

      wsRegions.on("region-update-end", (region: any) => {
        // fixes ignored first click after region resize on touch devices
        if (touchMoved) {
          document.body.click();
          touchMoved = false;
        }

        let times = seq.filter((n) => n.layer === 0).map((s) => s.time);
        const end = seq
          .filter((s) => s.layer === 0)
          .reduce((n, { duration }) => n + duration, 0);

        times.push(end);

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

      wsRegions.on("ready", () => {
        wsRegions.setVolume(0);

        const end = seq
          .filter((s) => s.layer === 0)
          .reduce((n, { duration }) => n + duration, 0);

        if (!regionSelect) {
          wsRegions.addRegion({
            id: "selection",
            start: 0,
            end: end,
            loop: false,
          });
          regionSelect = Object.values(wsRegions.regions.list)[0];
        }

        if (!regionLoop) {
          wsRegions.addRegion({
            id: "loop",
            start: 0,
            end: end,
            loop: true,
          });

          regionLoop = Object.values(wsRegions.regions.list)[1];
          regionLoop.on("out", (e: any) => {
            if (wsRegions.getCurrentTime() > regionLoop.end) {
              wsRegions.play(regionLoop.start);
            }
          });

          configZoom();
        } else {
          // sets playhead on randomize
          wsRegions.seekTo(
            Tone.Time(Tone.Transport.position).toSeconds() /
              wsRegions.getDuration()
          );
        }

        wsRegions.clearMarkers();
        seq.forEach((s) => {
          wsRegions.addMarker({ time: s.time });
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
    regionSelect = undefined;

    wsRegions.stop();
    wsRegions.clearRegions();
    wsRegions.clearMarkers();
    wsRegions.setPlaybackRate(1);
    wsRegions.zoom(0);
    wsRegions.empty();

    ws0.zoom(0);
    ws0.empty();
    ws0.backend.buffer = undefined;

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

    buffers.forEach((b) => b.buffer.dispose());
    seq.forEach((s) => s.player.dispose());
    seq = [];
    buffers = [];
    pallets = [];

    await Promise.all(
      times.map(async (t: number, idx: number) => {
        idx++;
        await fetch(`/drums/${folder}/${idx}.wav`)
          .then(async (response) => {
            return await response.arrayBuffer();
          })
          .then(async (arrayBuffer) => {
            const buff = await Tone.context.decodeAudioData(arrayBuffer);

            buffers.push({
              name: folder,
              cutIdx: idx,
              layer: 0,
              buffer: new Tone.Buffer(buff),
            });

            const bufferObj = buffers.find(
              (b) => b.layer === 0 && b.name === folder && b.cutIdx === idx
            );

            seq.push({
              layer: 0,
              time: t,
              duration: bufferObj
                ? parseFloat(bufferObj.buffer.duration.toFixed(6))
                : 0,
              player: new Tone.Player(bufferObj?.buffer).toDestination(),
              name: folder,
              cutIdx: idx,
            });
          })
          .catch((error) => {
            throw Error(`Asset failed to load: ${error.message}`);
          });
      })
    );

    seq.sort((a, b) => a.time - b.time);

    const end = seq
      .filter((s) => s.layer === 0)
      .reduce((n, { duration }) => n + duration, 0);

    Tone.Transport.setLoopPoints(0, end);
    Tone.Transport.loop = true;

    part?.dispose();
    part = new Tone.Part((time, value) => {
      const notes = seq.filter((s) => value.time === s.time);
      notes.forEach((n) => n.player.start(time));

      /* trim overlapping pieces
      players1[value.idx]?.stop(
        Tone.Time(time).toSeconds() + Tone.Time(value.duration).toSeconds()
      );
      */

      // start playhead at piece
      Tone.Draw.schedule(() => {
        if (regionLoop) {
          const piece = seq.find((s) => s.layer === 0 && s.time === value.time);
          if (piece) {
            wsRegions.play(piece.time);
          }
        }
      }, time);
    }, seq).start(0);

    Tone.Transport.position = "0:0:0";

    await drawLayer("silence");
    await drawLayer(0);

    setSpeed(1);
    setZoom(0);
    setFader(0);
    setSelectedFolder(folder);
    setLoading(true);
    setSelectedLayer(0);
  };

  const originalClick = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    listClick(undefined, selectedFolder);
  };

  const randomClick = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // group notes by time
    const timesSeq = seq.reduce(
      (groups: any, item) => ({
        ...groups,
        [item.time]: [...(groups[item.time] || []), item],
      }),
      {}
    );

    let noteArray: any[] = [];
    Object.keys(timesSeq).forEach((k, i) => {
      noteArray.push(timesSeq[k]);
    });

    // get region indexes for array shuffle
    const baseSeq = seq.filter((n) => n.layer === 0);
    const startIdx = baseSeq.findIndex((n) => n.time === regionSelect.start);
    let endIdx = baseSeq.findIndex((n) => n.time === regionSelect.end);
    if (endIdx === -1) {
      endIdx = baseSeq.length;
    }

    const shuffled = arrShuffle(noteArray.slice(startIdx, endIdx));
    noteArray.splice(startIdx, shuffled.length, ...shuffled);

    // dispose objects?
    seq = [];

    // could notes be scheduled more precisely to avoid dropouts?
    part.clear();
    let durTotal = 0;
    noteArray.forEach((notes, idx) => {
      if (idx) {
        durTotal += noteArray[idx - 1][0].duration;
      }

      notes.forEach((n: any, i: number) => {
        const ret = { ...n, time: parseFloat(durTotal.toFixed(6)) };
        if (!i) {
          // pass player into part?
          part.add(ret.time, { ...ret, player: undefined });
        }
        seq.push({ ...ret });
      });
    });

    let times = seq.filter((n) => n.layer === 0).map((s) => s.time);
    const end = seq
      .filter((n) => n.layer === 0)
      .reduce((n, { duration }) => n + duration, 0);

    times.push(end);

    let snapStart = closest(times, regionLoop.start);
    let snapEnd = closest(times, regionLoop.end);

    Tone.Transport.setLoopPoints(snapStart / speed, snapEnd / speed);

    regionLoop.update({
      start: snapStart,
      end: snapEnd,
    });

    regionSelect.update({
      start: closest(times, regionSelect.start),
      end: closest(times, regionSelect.end),
    });

    await drawLayer(0);
    await drawLayer(1);
    await drawLayer(2);
  };

  const downloadClick = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const wav = toWav(wsRegions.backend.buffer);
    const blob = new window.Blob([new DataView(wav)], {
      type: "audio/wav",
    });
    const blobUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = blobUrl;
    anchor.download = selectedFolder + "_PHREAKED";
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
      wsRegions.pause();
      wsRegions.seekTo(regionLoop.start / wsRegions.getDuration());
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

    let layerSeq = seq.filter((n) => n.layer === selectedLayer);

    const times = layerSeq.map((s) => s.time);
    times.push(layerSeq.reduce((n, { duration }) => n + duration, 0));

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

    seq.forEach((s: any) => (s.player.playbackRate = val));

    Tone.Transport.setLoopPoints(regionLoop.start / val, regionLoop.end / val);
    wsRegions.setPlaybackRate(val);
    setSpeed(val);
  };

  const changeZoom = (val: number) => {
    wsRegions.zoom(val);
    ws0.zoom(val);
    ws1.zoom(val);
    ws2.zoom(val);
    setZoom(val);
  };

  const changeFader = (val: number) => {
    if (val < 0) {
      seq
        .filter((s) => s.layer === 1)
        .forEach((n) => {
          n.player.set({
            volume: val,
          });
        });
      seq
        .filter((s) => s.layer === 0)
        .forEach((n) => {
          n.player.set({
            volume: 0,
          });
        });
    } else if (val > 0) {
      seq
        .filter((s) => s.layer === 0)
        .forEach((n) => {
          n.player.set({
            volume: val * -1,
          });
        });
      seq
        .filter((s) => s.layer === 1)
        .forEach((n) => {
          n.player.set({
            volume: 0,
          });
        });
    }

    setFader(val);
  };

  const changeLayer2Volume = (val: number) => {
    seq
      .filter((s) => s.layer === 2)
      .forEach((n) => {
        n.player.set({
          volume: val,
        });
      });
    setLayer2Volume(val);
  };

  const findMatches = async (layer: number, selection?: boolean) => {
    let srcTable = table.filter((r) => r.n === selectedFolder);

    // load pallet
    if (!selection || !buffers.filter((b) => b.layer === layer).length) {
      const newPallet = table.filter(
        (r) =>
          r.n ===
          props.folders[Math.floor(Math.random() * props.folders.length)]
      );

      const pallet = pallets.find((p) => p.layer === layer);
      if (pallet) {
        pallet.sounds = newPallet;
      } else {
        pallets.push({ layer: layer, sounds: newPallet });
      }
    }

    // find matches
    let matches: any = [];
    srcTable.forEach((src, idx) => {
      const pallet = pallets.find((p) => p.layer === layer);

      if (pallet) {
        const t = pallet.sounds.map((r) => {
          const freqDiff = Math.abs(r.f - src.f);
          const durDiff = Math.abs(r.d - src.d);
          return {
            ...r,
            fDiff: freqDiff,
            dDiff: durDiff,
            t: seq.filter((s) => s.layer === 0)[idx].time,
          };
        });

        t.sort((a, b) => a.dDiff - b.dDiff || a.fDiff - b.fDiff);

        const r = Math.floor(Math.random() * 3);
        matches.push(t[r]);
      }
    });

    if (selection) {
      matches = matches.filter(
        (m: any) => m.t >= regionSelect.start && m.t < regionSelect.end
      );
    }

    // dispose buffer and remove duplicate buffers
    seq
      .filter((s) => s.layer === layer)
      .forEach((n) => {
        const buff = buffers.find(
          (b) => b.name === n.name && b.cutIdx === n.cutIdx
        );

        if (buff) {
          if (selection) {
            if (n.time >= regionSelect.start && n.time < regionSelect.end) {
              // check for notes outside of selection using same buffer
              const sameBufferNotes = seq
                .filter(
                  (s) =>
                    s.layer === layer &&
                    (s.time < regionSelect.start || s.time >= regionSelect.end)
                )
                .filter((nn) => nn.name === n.name && nn.cutIdx === n.cutIdx);

              if (!sameBufferNotes.length) {
                buff.buffer.dispose();
              }
            }
          } else {
            buff.buffer.dispose();
          }
        }
      });

    // modify sequence
    if (selection) {
      seq
        .filter(
          (s) =>
            s.layer === layer &&
            s.time >= regionSelect.start &&
            s.time < regionSelect.end
        )
        .forEach((n) => {
          buffers = buffers.filter(
            (b) =>
              b.layer !== layer || (b.name !== n.name && b.cutIdx !== n.cutIdx)
          );
        });

      seq = seq.filter(
        (s) =>
          s.layer !== layer ||
          s.time < regionSelect.start ||
          s.time >= regionSelect.end
      );
    } else {
      buffers = buffers.filter((b) => b.layer !== layer);
      seq = seq.filter((s) => s.layer !== layer);
    }

    // download and add buffers, sequence notes
    await Promise.all(
      matches.map(async (m: any, idx: number) => {
        await fetch(`/drums/${m.n}/${m.i}.wav`)
          .then(async (response) => {
            return await response.arrayBuffer();
          })
          .then(async (arrayBuffer) => {
            const buff = await Tone.context.decodeAudioData(arrayBuffer);

            let bufferObj = buffers.find(
              (b) => b.name === m.n && b.cutIdx === m.i
            );

            if (!bufferObj) {
              buffers.push({
                name: m.n,
                cutIdx: m.i,
                layer: layer,
                buffer: new Tone.Buffer(buff),
              });
            }

            bufferObj = buffers.find((b) => b.name === m.n && b.cutIdx === m.i);

            seq.push({
              layer: layer,
              time: m.t,
              duration: bufferObj
                ? parseFloat(bufferObj.buffer.duration.toFixed(6))
                : 0,
              player: new Tone.Player(bufferObj?.buffer).toDestination(),
              name: m.n,
              cutIdx: m.i,
            });
            //  }
          })
          .catch((error) => {
            throw Error(`Asset failed to load: ${error.message}`);
          });
      })
    );

    seq.sort((a, b) => a.time - b.time);

    await drawLayer(layer);
  };

  const drawLayer = async (layer: number | "silence") => {
    const duration = seq
      .filter((s) => s.layer === 0)
      .reduce((n, { duration }) => n + duration, 0);

    Tone.Offline(({ transport }) => {
      if (layer !== "silence") {
        const notes = seq
          .filter((note) => note.layer === layer)
          .map((p) => ({
            time: p.time,
            duration: p.duration,
            player: new Tone.Player(p.player.buffer.get()).toDestination(),
            mute: p.player.mute,
          }));

        new Tone.Part(
          (time, value) => {
            const note = notes.find((o) => o.time === value.time);

            if (note && !note.mute) {
              note.player.start(time);
            }
          },
          seq.filter((s) => s.layer === layer)
        ).start(0);
      }

      transport.start(0);
    }, duration).then((buffer) => {
      if (layer === "silence") {
        wsRegions.loadDecodedBuffer(buffer.get());
      } else if (layer === 0) {
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

    seq
      .filter((s) => s.layer === layer)
      .forEach((n) => {
        if (n.time >= regionSelect.start && n.time < regionSelect.end) {
          const mute = Math.round(Math.random()) ? true : false;

          n.player.set({
            mute: mute,
          });
        }
      });

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

        <div
          id="ws0"
          className={`ws ${selectedLayer === 0 ? "selected" : ""}`}
        />
        <div
          id="ws1"
          className={`ws ${selectedLayer === 1 ? "selected" : ""}`}
        />
        <div
          id="ws2"
          className={`ws ${selectedLayer === 2 ? "selected" : ""}`}
        />
        <div id="wsRegions" className={`layer${selectedLayer}`} />

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

            ["#wsRegions", "#ws0", "#ws1", "#ws2"].forEach((n) => {
              const container = document.querySelector(n) as HTMLDivElement;

              if (container) {
                container.scrollLeft = val;
              }
            });

            setScroll(val);
          }}
          disabled={
            loading ||
            zoom === Math.floor(window.innerWidth / wsRegions?.getDuration())
          }
        />
        <input
          id="zoom"
          type="range"
          step={20}
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
                className={folder === selectedFolder ? styles.selected : ""}
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
            onClick={(e) =>
              selectedLayer ? findMatches(selectedLayer, true) : randomClick(e)
            }
            disabled={loading}
          >
            <Image
              src={loading ? "dice_disabled.svg" : "dice.svg"}
              alt="dice"
              width={24}
              height={24}
            />
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

          <button
            disabled={loading || selectedLayer === 0}
            onClick={() => findMatches(selectedLayer)}
          >
            Pallet
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
