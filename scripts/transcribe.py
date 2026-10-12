"""Transcribe a real audio file; emit progress as JSON lines for the workbench."""
import argparse
import json
import os
import sys

from faster_whisper import WhisperModel

sys.stdout.reconfigure(encoding="utf-8")
parser = argparse.ArgumentParser()
parser.add_argument("audio")
parser.add_argument("--model", required=True)
args = parser.parse_args()


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


try:
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=min(6, os.cpu_count() or 4), local_files_only=True)
    segments, info = model.transcribe(args.audio, beam_size=5, vad_filter=True, word_timestamps=False, condition_on_previous_text=False)
    emit({"type": "info", "language": info.language, "duration": info.duration})
    count = 0
    for segment in segments:
        text = segment.text.strip()
        if not text or (segment.no_speech_prob > 0.7 and segment.avg_logprob < -1):
            continue
        count += 1
        emit({"type": "segment", "startSec": segment.start, "endSec": segment.end, "text": text})
    emit({"type": "done", "count": count, "language": info.language, "duration": info.duration})
except Exception as error:
    emit({"type": "error", "message": str(error)})
    sys.exit(1)
