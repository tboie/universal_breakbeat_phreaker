import glob
import os
import wave
import contextlib
import json

data = []
drums_path = "/Users/admin/Desktop/scripts/test"
for root, dirs, files in os.walk(drums_path):
    for dir in sorted(dirs):
        times = []
        os.chdir(drums_path + "/" + dir)

        obj = {}
        obj["n"] = dir
        obj["c"] = []
        for file in sorted(glob.glob("*.txt")):
            if file != "times.txt":
                print("get_freqAvg_Duration " + file);
                
                time = "{:.6f}".format(
                    float(file[file.rindex('_')+1:].replace(".txt", "")))
                times.append(time)

                props = []
                with open(file) as f:
                    freqTimes = 0
                    freqTotal = 0

                    for line in sorted(f):
                        val = float(line.split(" ")[1])
                        freqTotal += val
                        freqTimes += 1

                        if 'str' in line:
                            break

                    freqAvg = float("{:.1f}".format(freqTotal / freqTimes))

                with contextlib.closing(wave.open(file.replace(".txt", ".wav"), 'r')) as f:
                    frames = f.getnframes()
                    rate = f.getframerate()
                    duration = float("{:.6f}".format(frames / float(rate)))

                props.append(duration)
                props.append(freqAvg)
                obj["c"].append(props)

                os.remove(file)

        data.append(obj)

        if len(times) == 0:
            print(dir + " has no times")

        with open('times.txt', 'w') as f_times:
            for t in times:
                f_times.write(str(t) + "\n")
            f_times.close()

os.chdir(drums_path)
with open('data.json', 'w') as my_file:
    json.dump(data, my_file)
