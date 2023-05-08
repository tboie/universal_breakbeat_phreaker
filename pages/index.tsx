import Head from "next/head";
import Image from "next/image";
import styles from "@/styles/Home.module.css";
import { promises as fs } from "fs";
import path from "path";
import { useEffect, useRef, useState } from "react";

import * as Tone from "tone";

//@ts-ignore
import toWav from "audiobuffer-to-wav";
import JSZip from "jszip";

import data from "../public/data/data.json";

let init = false;

let ws0: any;
let ws1: any;
let ws2: any;
let wsRegions: any;

let regionLoop: any;
let regionSelect: any;

let touchMoved = false;

type TBuffer = {
  layer: number;
  name: string;
  cutIdx: number;
  buffer: Tone.ToneAudioBuffer;
};

type TSeq = {
  time: number; // TODO: verify 6 decimal standard throughout
  layer: number;
  name: string;
  cutIdx: number;
  duration: number;
  player: Tone.Player;
};

type TPallet = {
  layer: number;
  sounds: TableRow[];
};

let buffers: TBuffer[] = [];
let seq: TSeq[] = [];
let pallets: TPallet[] = [];
let part: Tone.Part;

// all pieces data table
// use indexdb?
type TableRow = {
  name: string;
  cutIdx: number;
  duration: number;
  freq: number;
};

const table: TableRow[] = [];
(data as { n: string; c: [[number, number]] }[]).forEach((b) => {
  b.c.forEach((v, i) => {
    const row = {
      name: b.n,
      cutIdx: i + 1,
      duration: v[0],
      freq: v[1],
    };
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
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);

  const [selectedFolder, setSelectedFolder] = useState("");
  const [selectedLayer, setSelectedLayer] = useState(0);
  const [selectedRegion, setSelectedRegion] = useState<"loop" | "select">(
    "loop"
  );

  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [fader, setFader] = useState(0);
  const [layer2Volume, setLayer2Volume] = useState(0);

  const [display, setDisplay] = useState<"playlist" | "controls">("playlist");
  const [pallet1Loaded, setPallet1Loaded] = useState(false);
  const [pallet2Loaded, setPallet2Loaded] = useState(false);

  const refPlaying = useRef(playing);
  refPlaying.current = playing;

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
        waveColor: "#9D00FF",
        fillParent: false,
        scrollParent: false,
      });

      wsRegions = WaveSurfer.create({
        container: "#wsRegions",
        height: 200,
        waveColor: "transparent",
        progressColor: "transparent",
        cursorColor: "skyblue",
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
        const waveEle = document.querySelector("#wsRegions") as HTMLDivElement;

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
          regionSelect.on("click", (e: any) => {
            e.stopPropagation();
            e.preventDefault();

            setSelectedRegion("select");
          });
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

          regionLoop.on("click", (e: any) => {
            e.stopPropagation();
            e.preventDefault();

            setSelectedRegion("loop");
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

    setSelectedFolder(folder);
    setLoading(true);

    resetWaveSurfer();

    let times: number[] = [];
    await fetch(`/drums/${folder}/times.txt`)
      .then((response) => response.text())
      .then((text) => {
        times = text
          .split("\n")
          .filter((t) => t)
          .map((t) => parseFloat(t));
      });

    part?.dispose();
    seq.forEach((s) => s.player.dispose());
    buffers.forEach((b) => b.buffer.dispose());
    seq = [];
    buffers = [];
    pallets = [];

    await Promise.all(
      times.map(async (t, idx) => {
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

    part = new Tone.Part((time, value) => {
      value.player.start(time);

      /* trim overlapping pieces
      players1[value.idx]?.stop(
        Tone.Time(time).toSeconds() + Tone.Time(value.duration).toSeconds()
      );
      */

      // start playhead at piece
      Tone.Draw.schedule(() => {
        if (regionLoop && refPlaying.current) {
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
    setScroll(0);
    setZoom(0);
    setFader(0);
    setLayer2Volume(0);
    setLoading(false);
    setSelectedLayer(0);
    setSelectedRegion("loop");
    setPallet1Loaded(false);
    setPallet2Loaded(false);
  };

  const uneraseClick = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setLoading(true);

    seq
      .filter(
        (n) =>
          n.layer === selectedLayer &&
          n.time >= regionSelect.start &&
          n.time < regionSelect.end
      )
      .forEach((n) => n.player.set({ mute: false }));

    await drawLayer(selectedLayer);

    setLoading(false);
  };

  const shuffleClick = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setLoading(true);

    // group notes by time
    const timesSeq: { [key: string]: TSeq[] } = seq.reduce(
      (groups: any, item) => ({
        ...groups,
        [item.time]: [...(groups[item.time] || []), item],
      }),
      {}
    );

    let noteArray: TSeq[][] = [];
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

      notes.forEach((n) => {
        const ret = { ...n, time: parseFloat(durTotal.toFixed(6)) };
        part.add(ret.time, { ...ret });
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

    await drawLayer("silence");
    await drawLayer(0);
    await drawLayer(1);
    await drawLayer(2);

    setLoading(false);
  };

  const downloadClick = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setLoading(true);

    const duration = seq
      .filter((s) => s.layer === 0)
      .reduce((n, { duration }) => n + duration, 0);

    await Tone.Offline(({ transport }) => {
      const notes = seq.map((p) => ({
        time: p.time,
        duration: p.duration,
        player: new Tone.Player(p.player.buffer.get()).toDestination(),
      }));

      new Tone.Part((time, value) => {
        value.player.start(time);
      }, notes).start(0);

      transport.start(0);
    }, duration).then(async (buffer) => {
      const wavRender = toWav(buffer);

      const wavLayer0 = ws0.backend.buffer
        ? toWav(ws0.backend.buffer)
        : undefined;
      const wavLayer1 = ws1.backend.buffer
        ? toWav(ws1.backend.buffer)
        : undefined;
      const wavLayer2 = ws2.backend.buffer
        ? toWav(ws2.backend.buffer)
        : undefined;

      const zip = new JSZip();
      const sounds = zip.folder("universal breakbeat phreaker");
      sounds?.file("rendered.wav", wavRender);

      if (wavLayer0) sounds?.file("layer_0.wav", wavLayer0);
      if (wavLayer1) sounds?.file("layer_1.wav", wavLayer1);
      if (wavLayer2) sounds?.file("layer_2.wav", wavLayer2);

      await zip.generateAsync({ type: "blob" }).then(function (content) {
        const blobUrl = window.URL.createObjectURL(content);
        const anchor = document.createElement("a");

        anchor.href = blobUrl;
        anchor.download = selectedFolder + "______PHREAKED.zip";
        anchor.click();

        window.URL.revokeObjectURL(blobUrl);
      });
    });

    setLoading(false);
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
    dir: "left" | "right",
    region: any
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const layerSeq = seq.filter((n) => n.layer === 0);

    const times = layerSeq.map((s) => s.time);
    times.push(layerSeq.reduce((n, { duration }) => n + duration, 0));

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
            volume: val === -20 ? -100 : val,
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
            volume: val === 20 ? -100 : val * -1,
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
          volume: val === -20 ? -100 : val,
        });
      });
    setLayer2Volume(val);
  };

  const getLayerVolume = (layer: number) => {
    let val = fader;

    if (layer === 0) {
      if (fader > 0) {
        val = 0;
      } else if (fader === 20) {
        val = -100;
      }
    } else if (layer === 1) {
      if (fader > 0) {
        val = 0;
      } else if (fader === -20) {
        val = -100;
      }
    } else if (layer === 2) {
      val = layer2Volume;
    }

    return val;
  };

  const findMatches = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number,
    selection?: boolean
  ) => {
    e.stopPropagation();
    e.preventDefault();

    setLoading(true);

    // map table vals to seq notes
    let srcTable: (TableRow | undefined)[] = seq
      .filter((n) => n.layer === 0)
      .map((n) => {
        const dataRow = table.find(
          (r) => r.name === n.name && r.cutIdx === n.cutIdx
        );
        if (dataRow) {
          return { ...n, duration: dataRow.duration, freq: dataRow.freq };
        }
      });

    // load random sound pallet
    if (!selection || !buffers.filter((b) => b.layer === layer).length) {
      let newPallet: TableRow[] = [];
      for (let i = 0; i < 100; i++) {
        newPallet.push(table[Math.floor(Math.random() * table.length)]);
      }

      // remove duplicates
      newPallet = newPallet.filter(
        (value, index, self) =>
          index ===
          self.findIndex(
            (t) => t.name === value.name && t.cutIdx === value.cutIdx
          )
      );

      const pallet = pallets.find((p) => p.layer === layer);
      if (pallet) {
        pallet.sounds = newPallet;
      } else {
        pallets.push({ layer: layer, sounds: newPallet });
      }
    }

    // find matches
    let matches: (TableRow & { dDiff: number; fDiff: number; time: number })[] =
      [];

    srcTable.forEach((src, idx) => {
      const pallet = pallets.find((p) => p.layer === layer);

      if (pallet && src) {
        const t = pallet.sounds.map((r) => {
          const freqDiff = Math.abs(r.freq - src.freq);
          const durDiff = Math.abs(r.duration - src.duration);
          return {
            ...r,
            fDiff: freqDiff,
            dDiff: durDiff,
            time: seq.filter((s) => s.layer === 0)[idx].time,
          };
        });

        t.sort((a, b) => a.dDiff - b.dDiff || a.fDiff - b.fDiff);

        const r = Math.floor(Math.random() * 3);
        matches.push(t[r]);
      }
    });

    if (selection) {
      matches = matches.filter(
        (m) => m.time >= regionSelect.start && m.time < regionSelect.end
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
      matches.map(async (m) => {
        await fetch(`/drums/${m.name}/${m.cutIdx}.wav`)
          .then(async (response) => {
            return await response.arrayBuffer();
          })
          .then(async (arrayBuffer) => {
            const buff = await Tone.context.decodeAudioData(arrayBuffer);

            let bufferObj = buffers.find(
              (b) => b.name === m.name && b.cutIdx === m.cutIdx
            );

            if (!bufferObj) {
              buffers.push({
                name: m.name,
                cutIdx: m.cutIdx,
                layer: layer,
                buffer: new Tone.Buffer(buff),
              });
            }

            bufferObj = buffers.find(
              (b) => b.name === m.name && b.cutIdx === m.cutIdx
            );

            seq.push({
              layer: layer,
              time: m.time,
              duration: bufferObj
                ? parseFloat(bufferObj.buffer.duration.toFixed(6))
                : 0,
              player: new Tone.Player(bufferObj?.buffer)
                .set({
                  volume: getLayerVolume(layer),
                })
                .toDestination(),
              name: m.name,
              cutIdx: m.cutIdx,
            });
            //  }
          })
          .catch((error) => {
            throw Error(`Asset failed to load: ${error.message}`);
          });
      })
    );

    seq.sort((a, b) => a.time - b.time);

    // set part
    part.clear();
    seq.forEach((n) => {
      part.add(n.time, { ...n });
    });

    await drawLayer(layer);

    setLoading(false);
    if (layer === 1) {
      setPallet1Loaded(true);
    } else if (layer === 2) {
      setPallet2Loaded(true);
    }
  };

  const drawLayer = async (layer: number | "silence") => {
    const duration = seq
      .filter((s) => s.layer === 0)
      .reduce((n, { duration }) => n + duration, 0);

    await Tone.Offline(({ transport }) => {
      if (layer !== "silence") {
        const notes = seq
          .filter((note) => note.layer === layer)
          .map((p) => ({
            time: p.time,
            duration: p.duration,
            player: new Tone.Player(p.player.buffer.get()).toDestination(),
            mute: p.player.mute,
          }));

        new Tone.Part((time, value) => {
          if (!value.mute) {
            value.player.start(time);
          }
        }, notes).start(0);
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

    setSelectedLayer(layer === selectedLayer ? 0 : layer);
  };

  const erase = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number
  ) => {
    e.stopPropagation();
    e.preventDefault();

    setLoading(true);

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

    await drawLayer(layer);

    setLoading(false);
  };

  const toggleDisplay = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setDisplay(display === "controls" ? "playlist" : "controls");
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
        <h1 className={styles.title}>
          {selectedFolder && loading
            ? "Loading"
            : "Universal Breakbeat Phreaker"}
        </h1>

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
        <div id="wsRegions" className={`ws layer${selectedLayer}`} />

        <div className={`${styles.toolbar}`}>
          <button
            className={`${
              selectedRegion === "select" ? styles.regionSelect : ""
            }`}
            onClick={(e) =>
              resizeRegion(
                e,
                "start",
                "left",
                selectedRegion === "loop" ? regionLoop : regionSelect
              )
            }
            disabled={loading}
          >
            {"<"}
          </button>
          <button
            className={`${
              selectedRegion === "select" ? styles.regionSelect : ""
            }`}
            onClick={(e) =>
              resizeRegion(
                e,
                "start",
                "right",
                selectedRegion === "loop" ? regionLoop : regionSelect
              )
            }
            disabled={loading}
          >
            {">"}
          </button>

          <span className={styles.info}>{speed + "x"}</span>

          <button
            className={`${
              selectedRegion === "select" ? styles.regionSelect : ""
            } ${styles.borderLeft}`}
            onClick={(e) =>
              resizeRegion(
                e,
                "end",
                "left",
                selectedRegion === "loop" ? regionLoop : regionSelect
              )
            }
            disabled={loading}
          >
            {"<"}
          </button>
          <button
            className={`${
              selectedRegion === "select" ? styles.regionSelect : ""
            }`}
            onClick={(e) =>
              resizeRegion(
                e,
                "end",
                "right",
                selectedRegion === "loop" ? regionLoop : regionSelect
              )
            }
            disabled={loading}
          >
            {">"}
          </button>
        </div>

        <div className={styles.toolbar}>
          <button
            className={`${selectedLayer === 1 ? styles.selected1 : ""}`}
            onClick={(e) => layerClick(e, 1)}
            disabled={loading}
          >
            1
          </button>

          <button
            className={`${selectedLayer === 2 ? styles.selected2 : ""}`}
            onClick={(e) => layerClick(e, 2)}
            disabled={loading}
          >
            2
          </button>

          <button
            disabled={loading || selectedLayer === 0}
            onClick={(e) => findMatches(e, selectedLayer)}
            className={`${
              selectedLayer === 0
                ? styles.color0
                : selectedLayer === 1
                ? styles.color1
                : styles.color2
            }`}
          >
            Pallet
          </button>

          <button
            onClick={(e) => findMatches(e, selectedLayer, true)}
            disabled={
              !selectedLayer ||
              loading ||
              (selectedLayer === 1 && !pallet1Loaded) ||
              (selectedLayer === 2 && !pallet2Loaded)
            }
            className={`${styles.white} ${
              selectedLayer === 0
                ? styles.color0
                : selectedLayer === 1
                ? styles.color1
                : styles.color2
            }`}
          >
            Flip
            {/*<Image
              src={loading ? "icons/dice_disabled.svg" : "icons/dice.svg"}
              alt="dice"
              width={24}
              height={24}
              />*/}
          </button>

          <button
            onClick={(e) => erase(e, selectedLayer)}
            disabled={
              loading ||
              (selectedLayer === 1 && !pallet1Loaded) ||
              (selectedLayer === 2 && !pallet2Loaded)
            }
            className={`${styles.white} ${
              selectedLayer === 0
                ? styles.color0
                : selectedLayer === 1
                ? styles.color1
                : styles.color2
            }`}
          >
            Erase
          </button>
        </div>

        <div className={styles.toolbar}>
          <button
            id="download"
            onClick={(e) => downloadClick(e)}
            disabled={loading}
          >
            Download
          </button>

          <button disabled={loading} onClick={(e) => playStopClick(e)}>
            {playing ? "Stop" : "Play"}
          </button>

          <button onClick={(e) => toggleDisplay(e)} disabled={loading}>
            {display === "controls" ? "Breaks" : "Controls"}
          </button>

          <button
            onClick={(e) => shuffleClick(e)}
            disabled={loading}
            className={styles.white}
          >
            Shuffle
          </button>

          <button
            onClick={(e) => uneraseClick(e)}
            disabled={
              loading ||
              (selectedLayer === 1 && !pallet1Loaded) ||
              (selectedLayer === 2 && !pallet2Loaded)
            }
            className={`${styles.white} ${
              selectedLayer === 0
                ? styles.color0
                : selectedLayer === 1
                ? styles.color1
                : styles.color2
            }`}
          >
            Unerase
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

        <div className={styles.content}>
          <div className={`${display === "playlist" ? styles.hide : ""}`}>
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
          </div>

          <ul
            className={`${styles.playlist} ${
              display === "controls" ? styles.hide : ""
            }`}
          >
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
