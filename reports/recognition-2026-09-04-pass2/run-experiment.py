"""Four predeclared English OCR strategies, exact frozen images, no text repair.

Uses the prior isolated Python environment and new official English ONNX weights.
Inference is offline. Output filenames are exclusive, so prior evidence is kept.
"""
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import socket
import sys
import time

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
ENV = HERE.parent / "recognition-2026-09-04/rapidocr-env"
sys.path.insert(0, str(ENV))


def block_network(*args, **kwargs):
    raise RuntimeError("Network connections forbidden during OCR inference")


socket.create_connection = block_network
socket.socket.connect = block_network
socket.socket.connect_ex = block_network
import onnxruntime
onnxruntime.disable_telemetry_events()
import cv2
from PIL import Image
from rapidocr import RapidOCR, LangRec, OCRVersion, ModelType
from omegaconf import OmegaConf


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


MODELS = {
    "Det.model_path": (ENV / "rapidocr/models/PP-OCRv6_det_small.onnx", "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f"),
    "Cls.model_path": (ENV / "rapidocr/models/ch_ppocr_mobile_v2.0_cls_mobile.onnx", "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c"),
    "Rec.model_path": (HERE / "models/en_PP-OCRv5_rec_mobile.onnx", "c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8"),
}
CONFIGURATIONS = [
    {"mode": "english-original", "engine": "default", "strategy": "original"},
    {"mode": "english-highres", "engine": "highres", "strategy": "original"},
    {"mode": "english-grid", "engine": "default", "strategy": "grid"},
    {"mode": "english-rotate90", "engine": "default", "strategy": "rotate90"},
]


def inputs_for(image, strategy):
    height, width = image.shape[:2]
    if strategy == "original":
        yield image, {"kind": "identity", "sourceWidth": width, "sourceHeight": height}
    elif strategy == "rotate90":
        yield cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE), {"kind": "rotate90-clockwise", "sourceWidth": width, "sourceHeight": height}
    else:
        for index, (fx, fy) in enumerate([(0, 0), (.4, 0), (0, .4), (.4, .4)]):
            x, y = int(width * fx), int(height * fy)
            right, bottom = min(width, x + math.ceil(width * .6)), min(height, y + math.ceil(height * .6))
            yield image[y:bottom, x:right].copy(), {"kind": "fixed-grid", "tileIndex": index, "rect": [x, y, right - x, bottom - y], "sourceWidth": width, "sourceHeight": height}


def map_boxes(boxes, transform):
    if boxes is None:
        return []
    result = []
    for polygon in boxes:
        points = []
        for x, y in polygon:
            x, y = float(x), float(y)
            if transform["kind"] == "fixed-grid":
                x, y = x + transform["rect"][0], y + transform["rect"][1]
            elif transform["kind"] == "rotate90-clockwise":
                x, y = y, transform["sourceHeight"] - 1 - x
            points.append([x, y])
        result.append(points)
    return result


def main():
    output = HERE / "english-strategies-raw.json"
    journal_path = output.with_suffix(".jsonl")
    if output.exists() or journal_path.exists():
        raise FileExistsError("Prior inference outputs exist; do not overwrite raw evidence")
    manifest_path = REPO / "datasets/critical-fields.v1.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    # Retain only image identity fields for recognition; expected values never
    # enter an engine call or strategy selection.
    samples = [(sample["id"], sample["sourcePath"], sample["sha256"]) for sample in manifest["samples"]]
    for sample_id, source_path, sha in samples:
        if digest(REPO / source_path) != sha:
            raise ValueError(f"Frozen source changed: {sample_id}")
    for path, sha in MODELS.values():
        if digest(path) != sha:
            raise ValueError(f"Official model checksum mismatch: {path.name}")
    params = {key: str(path) for key, (path, _) in MODELS.items()}
    params.update({"Rec.lang_type": LangRec.EN, "Rec.ocr_version": OCRVersion.PPOCRV5, "Rec.model_type": ModelType.MOBILE})
    engines = {}
    engine_metadata = {}
    for name in ["default", "highres"]:
        specific = {} if name == "default" else {"Global.max_side_len": 3200, "Det.limit_side_len": 960}
        started = time.perf_counter()
        engine = RapidOCR(params={**params, **specific})
        engines[name] = engine
        engine_metadata[name] = {"initializationMs": round((time.perf_counter() - started) * 1000), "config": OmegaConf.to_container(engine.cfg, resolve=True, enum_to_str=True)}
    session = {
        "type": "session", "engine": "RapidOCR 3.9.2", "onnxruntime": onnxruntime.__version__,
        "python": platform.python_version(), "platform": platform.platform(),
        "manifestSha256": digest(manifest_path), "planSha256": digest(HERE / "PLAN.md"),
        "configurations": CONFIGURATIONS, "engines": engine_metadata,
        "models": [{"name": path.name, "bytes": path.stat().st_size, "sha256": sha} for path, sha in MODELS.values()],
        "dependencies": {dist.metadata["Name"]: dist.version for dist in importlib.metadata.distributions(path=[str(ENV)])},
        "offlineInference": True, "pythonSocketConnectionsBlocked": True, "ortTelemetryDisabled": True,
        "manualCrop": False, "textEdited": False,
        "notes": "All four fixed configurations run on all eight images before scores are inspected. Original model outputs are retained. rawText joins unmodified engine strings with newline separators; grid outputs follow fixed tile order without deduplication or selection. Main boxes map to the EXIF-oriented original pixel space; raw engine boxes remain in subpasses. This is development evidence, not holdout or legal accuracy.",
    }
    rows = []
    with journal_path.open("x", encoding="utf-8") as journal:
        journal.write(json.dumps(session, ensure_ascii=False, default=str) + "\n")
        journal.flush()
        for configuration in CONFIGURATIONS:
            engine = engines[configuration["engine"]]
            for sample_id, source_path, sha in samples:
                started = time.perf_counter()
                row = {"sampleId": sample_id, "sourcePath": source_path, "sourceSha256": sha, "mode": configuration["mode"], "transcriptKind": "raw-ocr-unedited", "manuallyEdited": False, "rawText": "", "error": None,
                       "metadata": {"engine": session["engine"], "recognizer": "en_PP-OCRv5_rec_mobile", "detector": "PP-OCRv6_det_small", "strategy": configuration["strategy"], "texts": [], "boxes": [], "confidences": [], "passes": [], "sourceHashVerified": True}}
                try:
                    path = REPO / source_path
                    with Image.open(path) as stored:
                        row["metadata"]["storedSize"] = list(stored.size)
                        row["metadata"]["exifOrientation"] = stored.getexif().get(274, 1)
                    pixels = engine.load_img(str(path))
                    row["metadata"]["sourceSize"] = [pixels.shape[1], pixels.shape[0]]
                    for image, transform in inputs_for(pixels, configuration["strategy"]):
                        pass_started = time.perf_counter()
                        result = engine(image)
                        texts = list(result.txts or ())
                        boxes = [] if result.boxes is None else result.boxes.tolist()
                        scores = list(result.scores or ())
                        mapped = map_boxes(boxes, transform)
                        row["metadata"]["passes"].append({"texts": texts, "rawText": "\n".join(texts), "rawBoxes": boxes, "sourceBoxes": mapped, "confidences": scores, "transform": transform, "inputSize": [image.shape[1], image.shape[0]], "engineStageSeconds": result.elapse_list, "elapsedMs": round((time.perf_counter() - pass_started) * 1000)})
                        row["metadata"]["texts"].extend(texts)
                        row["metadata"]["boxes"].extend(mapped)
                        row["metadata"]["confidences"].extend(scores)
                    row["rawText"] = "\n".join(row["metadata"]["texts"])
                except Exception as error:
                    row["error"] = f"{type(error).__name__}: {error}"
                    # A partial configuration is explicitly failed, not scored
                    # as though every planned tile was processed.
                row["metadata"]["elapsedMs"] = round((time.perf_counter() - started) * 1000)
                rows.append(row)
                journal.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
                journal.flush()
                print(json.dumps({"mode": row["mode"], "sampleId": sample_id, "elapsedMs": row["metadata"]["elapsedMs"], "passes": len(row["metadata"]["passes"]), "error": row["error"]}), flush=True)
    with output.open("x", encoding="utf-8") as file:
        json.dump({"session": session, "rows": rows}, file, ensure_ascii=False, indent=2, default=str)
        file.write("\n")
    print(json.dumps({"completedRows": len(rows), "errors": sum(bool(row["error"]) for row in rows), "output": str(output)}), flush=True)


if __name__ == "__main__":
    main()
