import Head from "next/head";
import styles from "@/styles/Home.module.css";
import { promises as fs } from "fs";
import path, { normalize } from "path";
import { useEffect, useRef, useState } from "react";

import * as Tone from "tone";
import * as realtimeBpm from "realtime-bpm-analyzer";

//@ts-ignore
import toWav from "audiobuffer-to-wav";
import JSZip from "jszip";

import dataPallet0 from "../public/pallets/0/data.json";
import dataPallet1 from "../public/pallets/1/data.json";
import dataPallet2 from "../public/pallets/2/data.json";
import dataPallet3 from "../public/pallets/3/data.json";

let init = false;

let ws0: any;
let ws1: any;
let ws2: any;
let ws3: any;
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
  trim?: boolean;
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

const tablePallet0: TableRow[] = [];
(dataPallet0 as { n: string; c: [[number, number]] }[]).forEach((b) => {
  b.c.forEach((v, i) => {
    const row = {
      name: b.n,
      cutIdx: i,
      duration: v[0],
      freq: v[1],
    };
    tablePallet0.push(row);
  });
});

const tablePallet1: TableRow[] = [];
(dataPallet1 as { n: string; c: [[number, number]] }[]).forEach((b) => {
  b.c.forEach((v, i) => {
    const row = {
      name: b.n,
      cutIdx: i,
      duration: v[0],
      freq: v[1],
    };
    tablePallet1.push(row);
  });
});

const tablePallet2: TableRow[] = [];
(dataPallet2 as { n: string; c: [[number, number]] }[]).forEach((b) => {
  b.c.forEach((v, i) => {
    const row = {
      name: b.n,
      cutIdx: i,
      duration: v[0],
      freq: v[1],
    };
    tablePallet2.push(row);
  });
});

const tablePallet3: TableRow[] = [];
(dataPallet3 as { n: string; c: [[number, number]] }[]).forEach((b) => {
  b.c.forEach((v, i) => {
    const row = {
      name: b.n,
      cutIdx: i,
      duration: v[0],
      freq: v[1],
    };
    tablePallet3.push(row);
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

// app
export default function Home(props: { folders: any }) {
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [bpm, setBPM] = useState(0);

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
  const [layer3Volume, setLayer3Volume] = useState(0);

  const [allowDelete, setAllowDelete] = useState(false);

  const [display, setDisplay] = useState<"playlist" | "controls">("playlist");
  const [pallet1Loaded, setPallet1Loaded] = useState(false);
  const [pallet2Loaded, setPallet2Loaded] = useState(false);
  const [pallet3Loaded, setPallet3Loaded] = useState(false);

  const refPlaying = useRef(playing);
  refPlaying.current = playing;

  const refSelectedLayer = useRef(selectedLayer);
  refSelectedLayer.current = selectedLayer;

  useEffect(() => {
    // TODO: draw waveform outlines?
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
        waveColor: "#39FF14",
        fillParent: false,
        scrollParent: false,
      });

      ws1 = WaveSurfer.create({
        container: "#ws1",
        waveColor: "yellow",
        fillParent: false,
        scrollParent: false,
        plugins: [
          markers.create({
            markers: [],
          }),
        ],
      });

      ws2 = WaveSurfer.create({
        container: "#ws2",
        waveColor: "#9D00FF",
        fillParent: false,
        scrollParent: false,
        plugins: [
          markers.create({
            markers: [],
          }),
        ],
      });

      ws3 = WaveSurfer.create({
        container: "#ws3",
        waveColor: "#c19a6b",
        fillParent: false,
        scrollParent: false,
        plugins: [
          markers.create({
            markers: [],
          }),
        ],
      });

      wsRegions = WaveSurfer.create({
        container: "#wsRegions",
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
          ws3.zoom(minZoom);
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
        ws3.drawer.fireEvent("redraw");
      });

      document.body.addEventListener("touchmove", (event) => {
        touchMoved = true;
      });

      wsRegions.on("zoom", (val: number) => {
        configScroll();
      });

      wsRegions.on("region-update-end", async (region: any) => {
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

        /*
        if (region.id === "loop") {
          calcBPM(snapStart, snapEnd);
        }
        */

        setAllowDelete(regionSelect.start >= regionLoop.end ? true : false);
      });

      wsRegions.on("ready", () => {
        wsRegions.setVolume(0);

        const end = seq
          .filter((s) => s.layer === 0)
          .reduce((n, { duration }) => n + duration, 0);

        if (!regionLoop) {
          wsRegions.addRegion({
            id: "loop",
            start: 0,
            end: end,
            loop: true,
          });

          regionLoop = Object.values(wsRegions.regions.list)[0];
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

        if (!regionSelect) {
          wsRegions.addRegion({
            id: "selection",
            start: 0,
            end: end,
            loop: false,
          });

          regionSelect = Object.values(wsRegions.regions.list)[1];
          regionSelect.on("click", (e: any) => {
            e.stopPropagation();
            e.preventDefault();

            setSelectedRegion("select");
          });
        }

        wsRegions.clearMarkers();
        seq.forEach((s) => {
          wsRegions.addMarker({ time: s.time });
        });

        setLoading(false);
      });

      ws1.on("ready", () => {
        if (refSelectedLayer.current === 1) {
          drawLayerMarkers(1);
        }
      });

      ws2.on("ready", () => {
        if (refSelectedLayer.current === 2) {
          drawLayerMarkers(2);
        }
      });

      ws3.on("ready", () => {
        if (refSelectedLayer.current === 3) {
          drawLayerMarkers(3);
        }
      });

      /*
      ws0.on("ready", () => {
        const duration = ws0.getDuration();
        if (duration) {
          calcBPM(0, duration);
        }
      });
      */
    };

    if (!init) {
      init = true;
      initWaveSurfer();
    }
  }, []);

  // TODO: testing && bpm loading state?
  const calcBPM = async (regionStart: number, regionEnd: number) => {
    const duration = seq
      .filter(
        (s) => s.layer === 0 && s.time >= regionStart && s.time < regionEnd
      )
      .reduce((n, { duration }) => n + duration, 0);

    let newDuration = duration;
    let i = 2;

    // increment duration if < 30 seconds (so it works & more precision)
    while (newDuration < 30) {
      newDuration = duration * i;
      i++;
    }

    /*
    console.log("duration " + duration);
    console.log("loops " + (i - 1));
    console.log(newDuration);
    */

    await Tone.Offline(({ transport }) => {
      let notes = seq
        .filter(
          (s) => s.layer === 0 && s.time >= regionStart && s.time < regionEnd
        )
        .map((p) => ({
          time: p.time,
          duration: p.duration,
          player: new Tone.Player(p.player.buffer.get()).toDestination(),
          trim: p.trim,
        }));

      //console.log(notes);

      for (let n = 2; n <= i; n++) {
        // console.log(n - 1);

        let notesCopy = seq
          .filter(
            (s) => s.layer === 0 && s.time >= regionStart && s.time < regionEnd
          )
          .map((p) => ({
            time: duration * (n - 2) + p.time,
            duration: p.duration,
            player: new Tone.Player(p.player.buffer.get()).toDestination(),
            trim: p.trim,
          }));

        notes = notes.concat(notesCopy);
      }

      //console.log(notes);

      new Tone.Part((time, value) => {
        if (value.player.loaded) {
          value.player.start(time);

          if (value.trim) {
            value.player.stop(time + value.duration);
          }
        } else {
          console.log("buffer not loaded");
          console.log(value);
        }
      }, notes).start(0);

      transport.start(0);
    }, newDuration).then(async (buffer) => {
      //console.log("finished offline render");
      //console.log(buffer.duration);

      const buff = buffer.get();
      if (buff) {
        realtimeBpm.analyzeFullBuffer(buff).then((topCandidates) => {
          // console.log("topCandidates", topCandidates);
          setBPM(parseFloat((topCandidates[0].tempo * speed).toFixed(1)));
        });
      }
    });
  };

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

    ws3.zoom(0);
    ws3.empty();
    ws3.backend.buffer = undefined;
  };

  const listClick = async (
    e: React.MouseEvent<HTMLLIElement, MouseEvent> | undefined,
    folder: string
  ) => {
    e?.preventDefault();
    e?.stopPropagation();

    await Tone.start();

    setBPM(0);
    setSelectedFolder(folder);
    setLoading(true);

    resetWaveSurfer();

    let times: number[] = [];
    await fetch(`/pallets/0/${folder}/times.txt`)
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
        await fetch(`/pallets/0/${folder}/${idx}.wav`)
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
      if (value.player.loaded) {
        value.player.start(time);

        // yikes, figure out how to set value with part.at?
        const layerSeqNote = seq.find(
          (s) => s.time === value.time && s.layer === value.layer
        );

        if (layerSeqNote?.trim) {
          // next note?
          value.player.stop(time + value.duration);
        }
      } else {
        console.log("buffer not loaded");
        console.log(value);
      }

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

    await drawLayer("regions");
    await drawLayer(0);

    setSpeed(1);
    setScroll(0);
    setZoom(0);
    setFader(0);
    setLayer2Volume(0);
    setLayer3Volume(0);
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
      .forEach((n) =>
        n.player.set({ mute: false, volume: getLayerVolume(n.layer) })
      );

    await drawLayer(selectedLayer);

    setLoading(false);
  };

  const duplicateLoop = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setLoading(true);

    // TODO: verify selection handles and note times?
    const loopStart = parseFloat(regionLoop.start.toFixed(6));
    const loopEnd = parseFloat(regionLoop.end.toFixed(6));
    const loopDur = loopEnd - loopStart;

    const appendLoop = (layer: number) => {
      // copy seq after loopstart
      const seqCopy = [
        ...seq.filter((s) => s.layer === layer && s.time >= loopStart),
      ];

      // remove after loopend from seq
      seq = seq.filter(
        (s) => s.layer !== layer || (s.layer === layer && s.time < loopEnd)
      );

      // add time calculated note to seq and part
      seqCopy.forEach((s) => {
        seq.push({
          ...s,
          time: parseFloat((s.time + loopDur).toFixed(6)),
        });
      });

      // add notes to part
      seq.filter((s) => s.layer === layer).forEach((s) => part.add(s.time, s));
    };

    part.clear();
    appendLoop(0);
    appendLoop(1);
    appendLoop(2);

    Tone.Transport.setLoopPoints(loopStart, loopEnd + loopDur);

    await drawLayer("regions");
    await drawLayer(0);
    await drawLayer(1);
    await drawLayer(2);

    // see window resize callback
    window.dispatchEvent(new Event("resize"));

    regionLoop.update({
      start: loopStart,
      end: loopEnd + loopDur,
    });

    regionSelect.update({
      start: regionSelect.start,
      end: regionSelect.end,
    });

    setLoading(false);
  };

  const deleteSelection = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setLoading(true);
    setAllowDelete(false);

    // TODO: verify selection handles and note times?
    const selectStart = parseFloat(regionSelect.start.toFixed(6));
    const selectEnd = parseFloat(regionSelect.end.toFixed(6));
    const selectDur = selectEnd - selectStart;

    const deleteSelectionLayer = (layer: number) => {
      // copy seq after loopend
      const seqCopy = [
        ...seq.filter((s) => s.layer === layer && s.time >= selectEnd),
      ];

      // remove after loopstart from seq
      seq = seq.filter(
        (s) => s.layer !== layer || (s.layer === layer && s.time < selectStart)
      );

      // add time calculated note to seq and part
      seqCopy.forEach((s) => {
        seq.push({
          ...s,
          time: parseFloat((s.time - selectDur).toFixed(6)),
        });
      });

      // add notes to part
      seq.filter((s) => s.layer === layer).forEach((s) => part.add(s.time, s));
    };

    part.clear();

    deleteSelectionLayer(0);
    deleteSelectionLayer(1);
    deleteSelectionLayer(2);

    regionSelect.update({
      start: 0,
      end: seq
        .filter((n) => n.layer === 0)
        .reduce((n, { duration }) => n + duration, 0),
    });

    await drawLayer("regions");
    await drawLayer(0);
    await drawLayer(1);
    await drawLayer(2);
    await drawLayer(3);

    // see window resize callback
    window.dispatchEvent(new Event("resize"));

    setLoading(false);
  };

  const trimLayerSelection = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number,
    disable?: boolean
  ) => {
    e.preventDefault();
    e.stopPropagation();

    seq
      .filter(
        (s) =>
          s.layer === layer &&
          s.time >= regionSelect.start &&
          s.time < regionSelect.end
      )
      .forEach((ss) => Object.assign(ss, { trim: disable ? false : true }));

    await drawLayer(layer);
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

    // shuffle
    const shuffled = arrShuffle(noteArray.slice(startIdx, endIdx));
    noteArray.splice(startIdx, shuffled.length, ...shuffled);

    // set sequence
    let durTotal = 0;
    const seqTemp: TSeq[] = [];

    part.clear();
    noteArray.forEach((notes, idx) => {
      if (idx) {
        durTotal += noteArray[idx - 1][0].duration;
      }

      notes.forEach((n) => {
        const ret = { ...n, time: parseFloat(durTotal.toFixed(6)) };
        part.add(ret.time, { ...ret });
        seqTemp.push({ ...ret });
      });
    });

    seq = seqTemp;

    // set loop and regions
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

    await drawLayer("regions");
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
        trim: p.trim,
      }));

      new Tone.Part((time, value) => {
        if (value.player.loaded) {
          value.player.start(time);

          if (value.trim) {
            value.player.stop(time + value.duration);
          }
        } else {
          console.log("buffer not loaded");
          console.log(value);
        }
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
      const wavLayer3 = ws3.backend.buffer
        ? toWav(ws3.backend.buffer)
        : undefined;

      const zip = new JSZip();
      const sounds = zip.folder("universal breakbeat phreaker");
      sounds?.file("rendered.wav", wavRender);

      if (wavLayer0) sounds?.file("layer_0.wav", wavLayer0);
      if (wavLayer1) sounds?.file("layer_1.wav", wavLayer1);
      if (wavLayer2) sounds?.file("layer_2.wav", wavLayer2);
      if (wavLayer3) sounds?.file("layer_3.wav", wavLayer3);

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
    seq.forEach((s) => (s.player.playbackRate = val));

    Tone.Transport.setLoopPoints(regionLoop.start / val, regionLoop.end / val);
    wsRegions.setPlaybackRate(val);

    setSpeed(val);
  };

  const changeZoom = (val: number) => {
    wsRegions.zoom(val);
    ws0.zoom(val);
    ws1.zoom(val);
    ws2.zoom(val);
    ws3.zoom(val);
    setZoom(val);
  };

  const changeFader = (val: number) => {
    if (val < 0) {
      seq
        .filter((s) => s.layer === 1 && !s.player.mute)
        .forEach((n) => {
          n.player.set({
            volume: val === -20 ? -100 : val,
          });
        });
      seq
        .filter((s) => s.layer === 0 && !s.player.mute)
        .forEach((n) => {
          n.player.set({
            volume: 0,
          });
        });
    } else if (val > 0) {
      seq
        .filter((s) => s.layer === 0 && !s.player.mute)
        .forEach((n) => {
          n.player.set({
            volume: val === 20 ? -100 : val * -1,
          });
        });
      seq
        .filter((s) => s.layer === 1 && !s.player.mute)
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
      .filter((s) => s.layer === 2 && !s.player.mute)
      .forEach((n) => {
        n.player.set({
          volume: val === -20 ? -100 : val,
        });
      });
    setLayer2Volume(val);
  };

  const changeLayer3Volume = (val: number) => {
    seq
      .filter((s) => s.layer === 3 && !s.player.mute)
      .forEach((n) => {
        n.player.set({
          volume: val === -20 ? -100 : val,
        });
      });
    setLayer3Volume(val);
  };

  const getLayerVolume = (layer: number) => {
    let val = fader;

    if (layer === 0) {
      if (fader > 0) {
        val = fader * -1;
      } else if (fader === 20) {
        val = -100;
      } else {
        val = 0;
      }
    } else if (layer === 1) {
      if (fader < 0) {
        val = fader;
      } else if (fader === -20) {
        val = -100;
      } else {
        val = 0;
      }
    } else if (layer === 2) {
      val = layer2Volume;
    } else if (layer === 3) {
      val = layer3Volume;
    }

    return val;
  };

  const splitSelectionNotes = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number
  ) => {
    const regionNotes = seq.filter(
      (s) =>
        s.layer === layer &&
        s.time >= regionSelect.start &&
        s.time <= regionSelect.end
    );

    regionNotes.forEach((n, idx) => {
      const nextNote = regionNotes[idx + 1];

      // check last note?
      if (nextNote) {
        const noteDur = nextNote.time - n.time;
        const noteTime = parseFloat((n.time + noteDur / 2).toFixed(6));
        const newNote = {
          ...n,
          time: noteTime,
          layer: layer,
          cutIdx: n.cutIdx,
          duration: noteDur / 2,
          player: new Tone.Player().toDestination(),
        };

        seq.push(newNote);
        part.add(newNote.time, newNote);
      }
    });

    seq.sort((a, b) => a.time - b.time);
    findMatches(e, layer, true);
  };

  // 1 note for every 2 base seq notes
  const combineSelectionNotes = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number
  ) => {
    const selectionNotes = [
      ...seq.filter(
        (s) =>
          s.layer === layer &&
          s.time >= regionSelect.start &&
          s.time < regionSelect.end
      ),
    ];

    const combinedNotes = selectionNotes.filter((s, idx) => idx % 2 === 0);

    combinedNotes.forEach((n, idx) => {
      const nextNote = combinedNotes[idx + 1];
      let noteDur = 0;

      if (nextNote) {
        noteDur = parseFloat((nextNote.time - n.time).toFixed(6));
      } else {
        noteDur = parseFloat((regionSelect.end - n.time).toFixed(6));
      }

      Object.assign(n, { duration: noteDur });
    });

    seq = seq.filter(
      (s) =>
        s.layer !== layer ||
        s.time < regionSelect.start ||
        s.time >= regionSelect.end
    );

    combinedNotes.forEach((n) => {
      seq.push(n);
    });

    seq.sort((a, b) => a.time - b.time);

    // clear entire part :(
    // todo: set part event values
    /*
    part.clear();
    seq.forEach((s) => {
      part.add(s.time, s);
    });
    */

    findMatches(e, layer, true);
  };

  const resetSelectionNotes = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number
  ) => {
    const baseSelectionNotes = [
      ...seq.filter(
        (s) =>
          s.layer === 0 &&
          s.time >= regionSelect.start &&
          s.time < regionSelect.end
      ),
    ];

    seq = seq.filter(
      (s) =>
        s.layer !== layer ||
        s.time < regionSelect.start ||
        s.time >= regionSelect.end
    );

    baseSelectionNotes.forEach((s) => {
      seq.push({
        ...s,
        layer: layer,
        player: new Tone.Player().toDestination(),
      });
    });

    findMatches(e, layer, true);
  };

  const findMatches = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number,
    selection?: boolean,
    singleSample?: boolean
  ) => {
    e.stopPropagation();
    e.preventDefault();

    setLoading(true);

    let table = tablePallet0;

    if (selectedLayer === 1) {
      table = tablePallet1;
    } else if (selectedLayer == 2) {
      table = tablePallet2;
    } else if (selectedLayer == 3) {
      table = tablePallet3;
    }

    /* filter sounds > min note length?
      const minDur = seq
        .filter((s) => s.layer === (layerHasNotes ? layer : 0))
        .reduce((min, current) =>
          current.duration < min.duration ? current : min
        );
      */

    // TODO: duration constraints?
    table = table.filter(
      (n) =>
        /*n.duration < regionLoop.end + 1 - regionLoop.start &&*/ n.duration >
        0.1
    );

    const layerHasNotes =
      seq.filter((s) => s.layer === layer).length === 0 ? false : true;

    // map table vals to seq notes
    let srcTable: any[] = seq
      .filter((n) => n.layer === (layerHasNotes ? layer : 0))
      .map((n) => {
        if (layer) {
          // set note duration using next note
          const selectNotes = seq.filter(
            (s) => s.layer === (layerHasNotes ? layer : 0)
          );
          const noteIdx = selectNotes.findIndex((s) => s.time === n.time);
          const nextNote = selectNotes[noteIdx + 1];
          let noteDur = 0;

          if (nextNote) {
            noteDur = nextNote.time - n.time;
          }
          // last note
          // this errors?
          else if (n.time === selectNotes[selectNotes.length - 1].time) {
            noteDur =
              regionSelect.end - selectNotes[selectNotes.length - 1].time;
          }

          noteDur = parseFloat(noteDur.toFixed(6));

          // base note freq
          let baseNote = seq.find((s) => s.layer === 0 && s.time === n.time);
          // prev base note
          if (!baseNote) {
            baseNote = seq
              .filter((s) => s.layer === 0 && s.time < n.time)
              .slice(-1)[0];
          }

          const dataRow = tablePallet0.find(
            (r) => r.name === baseNote?.name && r.cutIdx === baseNote?.cutIdx
          );

          if (dataRow) {
            return {
              ...n,
              duration: noteDur,
              freq: dataRow.freq,
              mute: n.player.mute,
            };
          }
        } else {
          const dataRow = tablePallet0.find(
            (r) => r.name === n.name && r.cutIdx === n.cutIdx
          );

          if (dataRow) {
            return { ...n, freq: dataRow.freq, mute: n.player.mute };
          }
        }
      });

    if (layer == 0 && !pallets.filter((p) => p.layer === 0).length) {
      pallets.push({
        layer: 0,
        sounds: table.filter((r) => r.name === selectedFolder),
      });
    }

    // load random sound pallet
    if (
      !selection ||
      (layer && !buffers.filter((b) => b.layer === layer).length)
    ) {
      let newPallet: TableRow[] = [];
      let sounds: TableRow[] = [];

      if (singleSample) {
        const sampleNames = props.folders[layer].map((item: any) => item);
        const randomIndex = Math.floor(Math.random() * sampleNames.length);

        sounds = table.filter((r) => r.name === sampleNames[randomIndex]);
        sounds.forEach((s) => {
          newPallet.push(s);
        });
      }
      // calibrate this? harmonics?
      else {
        // does creating a smaller pallet create diversity in selected sounds?
        // TODO: refactor
        sounds = table.filter((r) => r.name !== selectedFolder);
        for (let i = 0; i < 150; i++) {
          const randSound = sounds[Math.floor(Math.random() * sounds.length)];
          newPallet.push(randSound);
        }
      }

      // remove duplicates
      if (layer) {
        newPallet = newPallet.filter(
          (value, index, self) =>
            index ===
            self.findIndex(
              (t) => t.name === value.name && t.cutIdx === value.cutIdx
            )
        );
      }

      const pallet = pallets.find((p) => p.layer === layer);
      if (pallet) {
        pallet.sounds = newPallet;
      } else {
        pallets.push({ layer: layer, sounds: newPallet });
      }
    }

    // find matches
    let matches: (TableRow & {
      dDiff: number;
      fDiff: number;
      time: number;
      mute: boolean;
    })[] = [];

    srcTable.forEach((src: any, idx) => {
      const pallet = pallets.find((p) => p.layer === layer);

      if (pallet && src) {
        const t = pallet.sounds.map((r) => {
          // Calibrate this?
          // Sound selection freq multiplier range
          // for octave like selections?
          const srcFreq = src.freq * (Math.floor(Math.random() * 2) + 1);
          const freqDiff = Math.abs(r.freq - srcFreq);
          const durDiff = Math.abs(r.duration - src.duration);
          return {
            ...r,
            fDiff: freqDiff,
            dDiff: durDiff,
            time: src.time,
            duration: src.duration,
            mute: src.mute,
          };
        });

        // Calibrate this? Harmonics? See other calibration
        t.sort((a, b) => a.dDiff - b.dDiff || a.fDiff - b.fDiff);

        /* potential diversity in selected sounds? depends on threshold of cuts?
        if (!singleSample) {
          t.reverse();
        }
        */

        // Calibrate this?
        // first x matches? consistency/diversity
        // 4 pieces in 30 seconds?
        // first 1-4 random list selection of pieces
        let r = 0;
        if (t.length >= 4) {
          r = Math.floor(Math.random() * 4);
        } else if (t.length >= 2 && t.length < 4) {
          r = Math.floor(Math.random() * t.length);
        }
        matches.push(t[r]);
      }
    });

    if (selection) {
      matches = matches
        // TODO: undefined
        .filter(
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
      matches
        // TODO: undefined
        .map(async (m) => {
          // this errors?
          // /pallets/2/Tony Cook & The GA's - Time Out (part1).rx2/1.wav
          // /pallets/1/Edwin Starr - Who Cares If You're Happy Or Not (I Do)_0/0.wav
          // /pallets/1/The New Mastersounds - Nervous 1_0/0.wav
          // /pallets/1/Ralph Carmichael - The Addicts Psalm (part6)_0/0.wav
          // console.log(`/pallets/${selectedLayer}/${m?.name}/${m.cutIdx}.wav`);
          await fetch(`/pallets/${selectedLayer}/${m?.name}/${m?.cutIdx}.wav`)
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
                duration: m.duration,
                player: new Tone.Player(bufferObj?.buffer)
                  .set({
                    volume: getLayerVolume(layer),
                    playbackRate: speed,
                    mute: m.mute,
                  })
                  .toDestination(),
                name: m.name,
                cutIdx: m.cutIdx,
                trim: true,
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
    } else if (layer === 3) {
      setPallet3Loaded(true);
    }
  };

  const drawLayer = async (layer: number | "regions") => {
    const duration = seq
      .filter((s) => s.layer === 0)
      .reduce((n, { duration }) => n + duration, 0);

    await Tone.Offline(({ transport }) => {
      if (layer !== "regions") {
        const notes = seq
          .filter((note) => note.layer === layer)
          .map((p) => ({
            time: p.time,
            duration: p.duration,
            player: new Tone.Player(p.player.buffer.get()).toDestination(),
            mute: p.player.mute,
            trim: p.trim,
          }));

        new Tone.Part((time, value) => {
          if (value.player.loaded) {
            if (!value.mute) {
              value.player.start(time);

              if (value.trim) {
                value.player.stop(time + value.duration);
              }
            }
          } else {
            console.log("buffer not loaded");
            console.log(value);
          }
        }, notes).start(0);
      }

      transport.start(0);
    }, duration).then((buffer) => {
      if (layer === "regions") {
        wsRegions.loadDecodedBuffer(buffer.get());
      } else if (layer === 0) {
        ws0.loadDecodedBuffer(buffer.get());
      } else if (layer === 1) {
        ws1.loadDecodedBuffer(buffer.get());
      } else if (layer === 2) {
        ws2.loadDecodedBuffer(buffer.get());
      } else if (layer === 3) {
        ws3.loadDecodedBuffer(buffer.get());
      }
    });
  };

  // TODO: better UI indication?
  const drawLayerMarkers = (layer: number) => {
    ws1.clearMarkers();
    ws2.clearMarkers();
    ws3.clearMarkers();

    seq
      .filter((s) => s.layer === layer)
      .forEach((n) => {
        if (layer === 1) {
          ws1.addMarker({ time: n.time });
        } else if (layer === 2) {
          ws2.addMarker({ time: n.time });
        } else if (layer === 3) {
          ws3.addMarker({ time: n.time });
        }
      });
  };

  const layerClick = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number
  ) => {
    e.stopPropagation();
    e.preventDefault();

    drawLayerMarkers(layer);
    setSelectedLayer(layer);
  };

  const erase = async (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    layer: number
  ) => {
    e.stopPropagation();
    e.preventDefault();

    setLoading(true);

    seq
      .filter(
        (s) =>
          s.layer === layer &&
          s.time >= regionSelect.start &&
          s.time < regionSelect.end &&
          !s.player.mute
      )
      .forEach((n) => {
        n.player.set({
          mute: Math.round(Math.random()) ? true : false,
        });
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

  const getBPMText = () => {
    if (bpm) {
      const computedBPM = parseFloat((bpm * speed).toFixed(1));
      const halfBPM = parseFloat((computedBPM / 2).toFixed(1));
      return ` ${halfBPM} / ${computedBPM} bpm`;
    } else {
      return "";
    }
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
        {/* 
        <h1 className={styles.title}>
          {
            selectedFolder && loading
              ? "Loading"
              : `Universal Breakbeat Phreaker` /*${getBPMText()}*/
        /*}*/
        /*  }
        </h1>
        */}
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

        <div
          id="ws3"
          className={`ws ${selectedLayer === 3 ? "selected" : ""}`}
        />

        <div id="wsRegions" className={`ws layer${selectedLayer}`} />

        {/* region move button bar, optional button bar?  increased accessibility?
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

          <button
            className={`${
              selectedRegion === "select" ? styles.regionSelect : ""
            } ${styles.borderLeft}`}
            onClick={(e) => {
              resizeRegion(
                e,
                "start",
                "left",
                selectedRegion === "loop" ? regionLoop : regionSelect
              );
              resizeRegion(
                e,
                "end",
                "left",
                selectedRegion === "loop" ? regionLoop : regionSelect
              );
            }}
            disabled={loading}
          >
            {"<"}
          </button>

          <button
            className={`${
              selectedRegion === "select" ? styles.regionSelect : ""
            }`}
            onClick={(e) => {
              resizeRegion(
                e,
                "start",
                "right",
                selectedRegion === "loop" ? regionLoop : regionSelect
              );
              resizeRegion(
                e,
                "end",
                "right",
                selectedRegion === "loop" ? regionLoop : regionSelect
              );
            }}
            disabled={loading}
          >
            {">"}
          </button>

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
        */}

        {/* layer button bar */}
        <div className={styles.toolbar}>
          <button
            className={`${selectedLayer === 0 ? styles.selected0 : ""}`}
            onClick={(e) => layerClick(e, 0)}
            disabled={loading}
          >
            0
          </button>

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
            className={`${selectedLayer === 3 ? styles.selected3 : ""}`}
            onClick={(e) => layerClick(e, 3)}
            disabled={loading}
          >
            3
          </button>
        </div>

        <div className={styles.toolbar}>
          <button
            id="download"
            onClick={(e) => downloadClick(e)}
            disabled={loading}
          >
            DL
          </button>

          <button
            disabled={loading}
            onClick={(e) => findMatches(e, selectedLayer)}
            className={`${
              selectedLayer === 0
                ? styles.color0
                : selectedLayer === 1
                ? styles.color1
                : selectedLayer === 2
                ? styles.color2
                : styles.color3
            }`}
          >
            RndPal
          </button>

          <button
            disabled={loading}
            onClick={(e) => findMatches(e, selectedLayer, false, true)}
            className={`${
              selectedLayer === 0
                ? styles.color0
                : selectedLayer === 1
                ? styles.color1
                : selectedLayer === 2
                ? styles.color2
                : styles.color3
            }`}
          >
            RndSmpl
          </button>

          {/* Load and Save? */}

          <button
            onClick={(e) => findMatches(e, selectedLayer, true)}
            disabled={
              loading ||
              (selectedLayer === 1 && !pallet1Loaded) ||
              (selectedLayer === 2 && !pallet2Loaded) ||
              (selectedLayer === 3 && !pallet3Loaded)
            }
            className={styles.white}
          >
            Flip
          </button>

          <button
            onClick={(e) => erase(e, selectedLayer)}
            disabled={
              loading ||
              (selectedLayer === 1 && !pallet1Loaded) ||
              (selectedLayer === 2 && !pallet2Loaded) ||
              (selectedLayer === 3 && !pallet3Loaded)
            }
            className={styles.white}
          >
            Mute
          </button>

          <button
            onClick={(e) => uneraseClick(e)}
            disabled={
              loading ||
              (selectedLayer === 1 && !pallet1Loaded) ||
              (selectedLayer === 2 && !pallet2Loaded) ||
              (selectedLayer === 3 && !pallet3Loaded)
            }
            className={styles.white}
          >
            Unmute
          </button>

          <button
            onClick={(e) => combineSelectionNotes(e, selectedLayer)}
            disabled={
              loading ||
              !selectedLayer ||
              !seq.filter((s) => s.layer === selectedLayer).length
            }
            className={styles.white}
          >
            Cmbn
          </button>
        </div>

        <div className={styles.toolbar}>
          <button disabled={loading} onClick={(e) => playStopClick(e)}>
            {playing ? "Stop" : "Play"}
          </button>

          <button onClick={(e) => toggleDisplay(e)} disabled={loading}>
            {display === "controls" ? "Breaks" : "Ctrls"}
          </button>

          {/*
          <button
            onClick={(e) => trimLayerSelection(e, selectedLayer)}
            disabled={
              loading ||
              !selectedLayer ||
              !seq.filter((s) => s.layer === selectedLayer).length
            }
            className={`${styles.white} ${
              selectedLayer === 0
                ? styles.color0
                : selectedLayer === 1
                ? styles.color1
                : styles.color2
            }`}
          >
            Trm
          </button>
          
          <button
            onClick={(e) => trimLayerSelection(e, selectedLayer, true)}
            disabled={
              loading ||
              !selectedLayer ||
              !seq.filter((s) => s.layer === selectedLayer).length
            }
            className={`${styles.white} ${
              selectedLayer === 0
                ? styles.color0
                : selectedLayer === 1
                ? styles.color1
                : styles.color2
            }`}
          >
            Untrm
          </button>
          */}

          <button onClick={(e) => duplicateLoop(e)} disabled={loading}>
            DupLoop
          </button>

          <button
            onClick={(e) => deleteSelection(e)}
            disabled={loading || !allowDelete}
            className={styles.white}
          >
            DelSel
          </button>

          <button
            onClick={(e) => shuffleClick(e)}
            disabled={loading}
            className={styles.white}
          >
            Shuff
          </button>

          <button
            onClick={(e) => resetSelectionNotes(e, selectedLayer)}
            disabled={
              loading ||
              !selectedLayer ||
              !seq.filter((s) => s.layer === selectedLayer).length
            }
            className={styles.white}
          >
            0Time
          </button>

          {/* TODO: triples? */}
          <button
            onClick={(e) => splitSelectionNotes(e, selectedLayer)}
            disabled={
              loading ||
              !selectedLayer ||
              !seq.filter((s) => s.layer === selectedLayer).length
            }
            className={styles.white}
          >
            Splt
          </button>
        </div>

        <div className={styles.content}>
          <div className={`${display === "playlist" ? styles.hide : ""}`}>
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

                ["#wsRegions", "#ws0", "#ws1", "#ws2", "#ws3"].forEach((n) => {
                  const container = document.querySelector(n) as HTMLDivElement;

                  if (container) {
                    container.scrollLeft = val;
                  }
                });

                setScroll(val);
              }}
              disabled={
                loading ||
                zoom ===
                  Math.floor(window.innerWidth / wsRegions?.getDuration())
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
              id="sliderVol2"
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

            <input
              id="sliderVol3"
              type="range"
              min={-20}
              max={0}
              value={layer3Volume}
              step={0.1}
              className={styles.slider}
              onInput={(e: React.ChangeEvent<HTMLInputElement>) => {
                changeLayer3Volume(parseFloat(e.target.value));
              }}
              disabled={loading}
            />

            {/* TODO: onset threshold */}
            {/*
            <input
              id="threshold"
              type="range"
              min={0}
              max={1.5}
              value={0}
              step={0.001}
              className={styles.slider}
              onInput={(e: React.ChangeEvent<HTMLInputElement>) => {}}
              disabled={true}
            />

            // every N onsets?
            // https://aubio.org/manual/latest/cli.html#aubiocut
            <input
              id="threshold"
              type="range"
              min={0}
              max={10}
              value={0}
              step={1}
              className={styles.slider}
              onInput={(e: React.ChangeEvent<HTMLInputElement>) => {}}
              disabled={true}
            />

            // lol?
            <button
              onClick={(e) => {}}
              disabled={true}
            >
              Apply to Lib
            </button>

             <button
              onClick={(e) => {}}
              disabled={true}
            >
              Add File
            </button>

             <button
              onClick={(e) => {}}
              disabled={true}
            >
              Remove File
            </button>
            */}
          </div>

          <ul
            className={`${styles.playlist} ${
              display === "controls" ? styles.hide : ""
            }`}
          >
            {props.folders[0]?.map((folder: any) => {
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
  // loads pallet sample names into props
  const palletDirs = [
    "public/pallets/0",
    "public/pallets/1",
    "public/pallets/2",
    "public/pallets/3",
  ];
  const folders: any = [];

  palletDirs.forEach(async (dir) => {
    const pallet = path.join(process.cwd(), dir);
    await folders.push(fs.readdir(pallet));
  });

  return {
    props: {
      folders: await Promise.all(folders),
    },
  };
}
