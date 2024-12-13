#!/bin/bash

# MAIN SCRIPT
# RUN THIS SCRIPT
# CHANGE PATHS IN OTHER SCRIPTS

# download audio:
# yt-dlp -x --audio-format "wav" --audio-quality 0 "URLhere"

python "cut_Segments.py"

# default 0.3
# 0.001 less threshold 
# ~1.1 for more threshold?
for x in ./*.wav ; do printf "aubiocutting $x \n"; mkdir "${x%.*}"; aubiocut -t 1.1 -i "$x" -c -o "${x%.*}"; done

for dir in ./*/; do
    for x in "$dir"/*.wav; do
        printf "aubiopitch $x \n"
        aubiopitch -i "$x" >> "${x%.*}.txt"
    done
done

printf "get_freqAvg_Duration.py \n"
python "get_freqAvg_Duration.py"

for dir in ./*/; do
    printf "renaming cuts to sequential order $dir \n"
    ls "$dir"/*.wav | cat -n | while read n f; do mv -n "$f" "$dir/$((n-1)).wav"; done
done