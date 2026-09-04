"""Isolated frozen-manifest OCR experiment. No app integration or text repair.

Run from the repo root with the bundled Python runtime. The installed experiment
packages must be in rapidocr-env beside this file. All inference inputs are local;
Python socket connections and ORT telemetry are disabled before model loading.
Use a NEW output filename on reruns; existing raw artifacts are never replaced.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import socket
import sys
import time

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE / "rapidocr-env"))


def block_network(*args, **kwargs):
    raise RuntimeError("Network access is forbidden in this local OCR experiment")


socket.create_connection = block_network
socket.socket.connect = block_network
socket.socket.connect_ex = block_network

import onnxruntime  # noqa: E402
onnxruntime.disable_telemetry_events()
import rapidocr  # noqa: E402
from rapidocr import RapidOCR  # noqa: E402
from omegaconf import OmegaConf  # noqa: E402


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, tuple):
        return [plain(item) for item in value]
    if isinstance(value, list):
        return [plain(item) for item in value]
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(HERE / "rapidocr-default-raw.json"))
    args = parser.parse_args()
    output_path = Path(args.output).resolve()
    if output_path.parent != HERE:
        raise ValueError("Experiment outputs must stay in this experiment directory")
    if output_path.exists() or output_path.with_suffix(".jsonl").exists():
        raise FileExistsError("Refusing to replace an existing raw OCR artifact")
    manifest_path = REPO / "datasets/critical-fields.v1.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    inputs = []
    # The recognizer receives path bytes only, never annotation values or boxes.
    for sample in manifest["samples"]:
        path = REPO / sample["sourcePath"]
        sha256 = digest(path)
        if sha256 != sample["sha256"]:
            raise ValueError(f"Frozen image hash mismatch: {sample['id']}")
        inputs.append((sample["id"], sample["sourcePath"], sha256, path))
    models = [
        {"name": path.name, "bytes": path.stat().st_size, "sha256": digest(path)}
        for path in sorted((Path(rapidocr.__file__).parent / "models").glob("*.onnx"))
    ]
    start = time.perf_counter()
    engine = RapidOCR()  # Exactly the packaged defaults; no parameter tuning.
    initialization_ms = round((time.perf_counter() - start) * 1000)
    session = {
        "type": "session",
        "mode": "rapidocr-default-whole-image",
        "engine": f"RapidOCR {importlib.metadata.version('rapidocr')}",
        "onnxruntime": onnxruntime.__version__,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "initializationMs": initialization_ms,
        "manifestPath": "datasets/critical-fields.v1.json",
        "manifestSha256": digest(manifest_path),
        "models": models,
        "config": OmegaConf.to_container(engine.cfg, resolve=True, enum_to_str=True),
        "offlineInference": True,
        "pythonSocketConnectionsBlocked": True,
        "ortTelemetryDisabled": True,
        "manualCrop": False,
        "manualRotation": False,
        "textEdited": False,
        "notes": "Eight frozen development photographs, not holdout. Original whole image input; package-internal preprocessing and crop classifier only. Raw text joins the unmodified engine strings in returned order with newline separators. All original strings, polygons, and scores retained separately.",
        "dependencies": {dist.metadata["Name"]: dist.version for dist in importlib.metadata.distributions(path=[str(HERE / "rapidocr-env")])},
    }
    rows = []
    with output_path.with_suffix(".jsonl").open("x", encoding="utf-8") as journal:
        journal.write(json.dumps(session, ensure_ascii=False, default=str) + "\n")
        journal.flush()
        for sample_id, source_path, sha256, path in inputs:
            start = time.perf_counter()
            row = {
                "sampleId": sample_id,
                "mode": session["mode"],
                "sourcePath": source_path,
                "sourceSha256": sha256,
                "transcriptKind": "raw-ocr-unedited",
                "manuallyEdited": False,
                "rawText": "",
                "error": None,
                "metadata": {
                    "engine": session["engine"],
                    "preprocessing": "RapidOCR 3.9.2 packaged defaults; original whole image path",
                    "manualCrop": False,
                    "manualRotation": False,
                    "sourceHashVerified": True,
                },
            }
            try:
                result = engine(str(path))
                texts = list(result.txts or ())
                row["rawText"] = "\n".join(texts)
                row["metadata"].update({
                    "texts": texts,
                    "boxes": plain(result.boxes),
                    "confidences": plain(result.scores),
                    "engineStageSeconds": plain(result.elapse_list),
                })
            except Exception as error:
                row["error"] = f"{type(error).__name__}: {error}"
            row["metadata"]["elapsedMs"] = round((time.perf_counter() - start) * 1000)
            rows.append(row)
            journal.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
            journal.flush()
            print(json.dumps({"sampleId": sample_id, "elapsedMs": row["metadata"]["elapsedMs"], "lines": len(row["metadata"].get("texts", [])), "error": row["error"]}), flush=True)
    with output_path.open("x", encoding="utf-8") as output:
        json.dump({"session": session, "rows": rows}, output, ensure_ascii=False, indent=2, default=str)
        output.write("\n")
    print(json.dumps({"output": str(output_path), "initializationMs": initialization_ms, "completed": len(rows), "errors": sum(bool(row["error"]) for row in rows)}), flush=True)


if __name__ == "__main__":
    main()
