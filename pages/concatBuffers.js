import util from "audio-buffer-utils";

onmessage = function (e) {
  let finalAudio = util.create();

  e.data.forEach((bufferArray) => {
    finalAudio = util.concat(finalAudio, util.create(bufferArray));
  });

  postMessage(util.data(finalAudio));
};
