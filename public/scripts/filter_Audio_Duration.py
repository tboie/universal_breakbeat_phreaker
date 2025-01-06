# Copy nested wav files having duration >= minimum to out directory
# usage: good for filtering results from proc_audio.sh

import os
from pydub import AudioSegment
import shutil

dir_in = '/Users/admin/Desktop/scripts/layer2'
dir_out = '/Users/admin/Desktop/scripts/filtered_cuts'
min_duration = 5 # seconds

def copy_file(source_file, destination_file):
    try:
        shutil.copy(source_file, destination_file)
        print(f"File copied from {source_file} to {destination_file} successfully.")
    except Exception as e:
        print(f"Error occurred: {e}")

def get_last_directory(path):
    # Normalize the path to handle any trailing slashes
    normalized_path = os.path.normpath(path)
    # Get the last directory
    last_directory = os.path.basename(normalized_path)
    return last_directory

def remove_file_extension(file_name):
    file_name_without_extension = os.path.splitext(file_name)[0]
    return file_name_without_extension

def get_audio_duration(file_path):
    audio = AudioSegment.from_file(file_path)
    duration_in_milliseconds = len(audio)
    duration_in_seconds = duration_in_milliseconds / 1000.0
    return duration_in_seconds

def loop_through_files(root_directory):
    for root, dirs, files in os.walk(root_directory):
        for file in files:
            file_path = os.path.join(root, file)
            file_extension = os.path.splitext(file_path)[1]
            
            if file_extension == ".wav":
                duration = get_audio_duration(file_path)
                
                if duration >= min_duration:
                    name = dir_out + "/" + get_last_directory(root) + "_" + file
                    
                    copy_file(file_path, name)
                    print(f"File: {file_path}, Type: {file_extension}, Duration: {duration}\n")

loop_through_files(dir_in)
