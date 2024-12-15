#!/bin/bash

# MAIN SCRIPT
# RUN THIS SCRIPT
# CHANGE PATHS IN OTHER SCRIPTS

# download audio:
# playlist options:
# https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#video-selection
# yt-dlp -x --audio-format "wav" --audio-quality 0 --match-filters "title~=experimental" --playlist-random  --skip-playlist-after-errors 999 "https://www.youtube.com/@mishapanfilov/videos"

python "cut_Segments.py"

# default 0.3
# 0.001 less threshold 
# ~1.1 for more threshold?
for x in ./*.wav ; do printf "\naubiocutting\n $x \n"; mkdir "${x%.*}"; aubiocut -t 1.1 -i "$x" -c -o "${x%.*}"; done

for dir in ./*/; do
    for x in "$dir"/*.wav; do
        printf "\naubiopitch\n $x \n"
        aubiopitch -i "$x" >> "${x%.*}.txt"
    done
done

python "get_freqAvg_Duration.py"

for dir in ./*/; do
    printf "\nrenaming cuts to sequential order\n $dir \n"
    ls "$dir"/*.wav | cat -n | while read n f; do mv -n "$f" "$dir/$((n-1)).wav"; done
done