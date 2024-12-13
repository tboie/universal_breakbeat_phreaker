import aubio
import math, os
import numpy as np
from pydub import AudioSegment

path = "/Users/admin/Desktop/scripts/test"

def find_closest(arr, val):
    idx = np.abs(arr - val).argmin()
    return arr[idx]

for filename in os.listdir(path):
    if filename.endswith('.wav'):
        print("cut_Segments.py cutting smaller segments of audio file\n" + filename + "\n")
        
        # Path to your audio file
        audio_path = filename

        # every 30 seconds + remaining ending onset
        cut_interval = 30

        # Open the audio file
        samplerate = 0  # 0 means aubio will automatically detect the sample rate
        win_s = 1024    # window size
        hop_s = win_s // 2  # hop size

        # Create aubio source object
        source = aubio.source(audio_path, samplerate, hop_s)
        samplerate = source.samplerate
        duration = source.duration / samplerate

        # Create aubio onset object
        onset = aubio.onset("default", win_s, hop_s, samplerate)

        # List to store onset timestamps
        onset_times = []

        # Read the audio file frame by frame
        total_frames = 0
        while True:
            samples, read = source()
            if onset(samples):
                onset_time = onset.get_last_s()
                onset_times.append(onset_time)
            total_frames += read
            if read < hop_s:
                break
            
        numIntervals = math.ceil(duration / cut_interval)

        start_time = 0
        for i in range(0, numIntervals):
            found_time = False
            cut_time = (i + 1) * cut_interval
            nearest = (np.abs(np.array(onset_times) - cut_time)).argmin()
            
            # use duration for last cut
            if i == numIntervals - 1:
                end_time = duration
            else:
                end_time = onset_times[nearest]
            
            audio = AudioSegment.from_wav(audio_path)
            cut_audio = audio[start_time * 1000: end_time * 1000]
            
            root = os.path.splitext(filename) 
            cut_audio.export(root[0] + "_" + str(i) + root[1], format="wav")
            
            print(str(start_time) + " " + str(end_time))
            
            start_time = end_time
            
            if i == numIntervals - 1:
                os.remove(audio_path)


        # Print the detected onset timestamps
        # print("Detected onsets at: ", onset_times)
        # print(f"Duration of the audio file: {duration:.2f} seconds")