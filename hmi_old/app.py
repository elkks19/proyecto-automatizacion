import base64
import io
import json
import os
import re
import argparse
import threading
import sys
import time
from collections import deque
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
os.environ.setdefault("YOLO_CONFIG_DIR", str(BASE_DIR / ".ultralytics"))
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import cv2
import numpy as np
from flask import Flask, jsonify, render_template, request
from PIL import Image
from ultralytics import YOLO

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

try:
    import pytesseract
    from pytesseract import TesseractNotFoundError
except ImportError:
    pytesseract = None

    class TesseractNotFoundError(Exception):
        pass

#080062026.pt
#best04052026.pt
DEFAULT_MODEL = BASE_DIR / "models" / "080062026.pt"
MODEL_PATH = Path(os.environ.get("YOLO_MODEL_PATH", DEFAULT_MODEL))
CONFIDENCE_DEFAULT = float(os.environ.get("YOLO_CONFIDENCE", "0.20"))
YOLO_IMAGE_SIZE = int(os.environ.get("YOLO_IMAGE_SIZE", "640"))
YOLO_MAX_DETECTIONS = int(os.environ.get("YOLO_MAX_DETECTIONS", "50"))
EXPECTED_QR_URL = "http://www.tcf.aduana.gob.bo"
OCR_LANG = os.environ.get("TESSERACT_LANG", "eng")
TESSERACT_CMD = os.environ.get("TESSERACT_CMD")
TESSDATA_PREFIX = os.environ.get("TESSDATA_PREFIX")
MQTT_BROKER_HOST = os.environ.get("MQTT_BROKER_HOST", "192.168.1.11")
MQTT_BROKER_PORT = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
MQTT_CLIENT_ID = os.environ.get("MQTT_CLIENT_ID", "corona-hmi-ia")
MQTT_ENABLED = os.environ.get("MQTT_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}
MQTT_TOPICS = [
    "corona/estado",
    "corona/sensores",
    "corona/peso",
    "corona/alcohol",
    "corona/ia",
    "corona/comandos",
    "corona/eventos",
]

if pytesseract is not None:
    if TESSERACT_CMD:
        pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
    else:
        env_tesseract = Path(sys.prefix) / "Library" / "bin" / "tesseract.exe"
        if env_tesseract.exists():
            pytesseract.pytesseract.tesseract_cmd = str(env_tesseract)

    if not TESSDATA_PREFIX:
        env_tessdata = Path(sys.prefix) / "share" / "tessdata"
        if (env_tessdata / f"{OCR_LANG}.traineddata").exists():
            os.environ["TESSDATA_PREFIX"] = str(env_tessdata)

app = Flask(__name__)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
model = None
model_lock = threading.Lock()
inference_lock = threading.Lock()
mqtt_client = None
mqtt_started = False
mqtt_lock = threading.Lock()
mqtt_state = {
    "connected": False,
    "enabled": MQTT_ENABLED,
    "broker": MQTT_BROKER_HOST,
    "port": MQTT_BROKER_PORT,
    "error": None,
    "last_update": None,
    "topics": {topic: None for topic in MQTT_TOPICS},
    "events": deque(maxlen=30),
}


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def now_ms():
    return int(time.time() * 1000)


def parse_mqtt_payload(raw_payload):
    text = raw_payload.decode("utf-8", errors="replace").strip()
    if not text:
        return text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def update_mqtt_topic(topic, payload):
    entry = {
        "topic": topic,
        "payload": payload,
        "received_at": now_ms(),
    }
    with mqtt_lock:
        mqtt_state["topics"][topic] = entry
        mqtt_state["last_update"] = entry["received_at"]
        mqtt_state["error"] = None
        if topic == "corona/eventos":
            mqtt_state["events"].appendleft(entry)


def mqtt_snapshot():
    with mqtt_lock:
        return {
            "connected": mqtt_state["connected"],
            "enabled": mqtt_state["enabled"],
            "broker": mqtt_state["broker"],
            "port": mqtt_state["port"],
            "error": mqtt_state["error"],
            "last_update": mqtt_state["last_update"],
            "topics": dict(mqtt_state["topics"]),
            "events": list(mqtt_state["events"]),
        }


def on_mqtt_connect(client, userdata, flags, reason_code, properties=None):
    connected = int(reason_code) == 0
    with mqtt_lock:
        mqtt_state["connected"] = connected
        mqtt_state["error"] = None if connected else f"MQTT no conectado: {reason_code}"
    if connected:
        for topic in MQTT_TOPICS:
            client.subscribe(topic)


def on_mqtt_disconnect(client, userdata, reason_code, properties=None):
    with mqtt_lock:
        mqtt_state["connected"] = False
        if int(reason_code) != 0:
            mqtt_state["error"] = f"MQTT desconectado: {reason_code}"


def on_mqtt_message(client, userdata, message):
    update_mqtt_topic(message.topic, parse_mqtt_payload(message.payload))


def start_mqtt_client():
    global mqtt_client, mqtt_started
    if mqtt_started or not MQTT_ENABLED:
        return

    mqtt_started = True
    if mqtt is None:
        with mqtt_lock:
            mqtt_state["error"] = "Instala paho-mqtt para leer MQTT."
        return

    try:
        mqtt_client = mqtt.Client(client_id=MQTT_CLIENT_ID, protocol=mqtt.MQTTv311)
        mqtt_client.on_connect = on_mqtt_connect
        mqtt_client.on_disconnect = on_mqtt_disconnect
        mqtt_client.on_message = on_mqtt_message
        mqtt_client.reconnect_delay_set(min_delay=1, max_delay=15)
        mqtt_client.connect_async(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=30)
        mqtt_client.loop_start()
    except Exception as exc:
        with mqtt_lock:
            mqtt_state["connected"] = False
            mqtt_state["error"] = str(exc)


def publish_mqtt(topic, payload):
    if not MQTT_ENABLED:
        raise ValueError("MQTT esta desactivado.")
    if mqtt_client is None:
        raise ValueError("MQTT no esta iniciado. Revisa paho-mqtt y la configuracion del broker.")
    if topic not in MQTT_TOPICS:
        raise ValueError(f"Topic MQTT no permitido: {topic}")
    result = mqtt_client.publish(topic, json.dumps(payload), qos=0, retain=False)
    if result.rc != 0:
        raise ValueError(f"No se pudo publicar en MQTT. Codigo: {result.rc}")


def get_model():
    global model
    if model is None:
        with model_lock:
            if model is None:
                try:
                    import torch

                    torch.set_num_threads(1)
                    torch.set_num_interop_threads(1)
                except Exception:
                    pass
                model = YOLO(str(MODEL_PATH))
    return model


def image_from_request():
    if "image" in request.files:
        return Image.open(request.files["image"].stream).convert("RGB")

    payload = request.get_json(silent=True) or {}
    image_data = payload.get("image")
    if image_data:
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]
        raw = base64.b64decode(image_data)
        return Image.open(io.BytesIO(raw)).convert("RGB")

    raise ValueError("No se recibio ninguna imagen.")


def encode_image(image_rgb):
    ok, buffer = cv2.imencode(".jpg", cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR))
    if not ok:
        raise ValueError("No se pudo codificar la imagen resultante.")
    return base64.b64encode(buffer).decode("utf-8")


def request_bool(payload, key, default=True):
    value = payload.get(key, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "off", ""}
    return bool(value)


def run_detection(image, confidence, return_annotated=True):
    frame = np.array(image)
    detector = get_model()
    result = detector.predict(
        frame,
        conf=confidence,
        imgsz=YOLO_IMAGE_SIZE,
        iou=0.8,
        max_det=YOLO_MAX_DETECTIONS,
        agnostic_nms=False,
        verbose=False,
    )[0]
    annotated = result.plot() if return_annotated else None

    detections = []
    for box in result.boxes:
        cls = int(box.cls[0])
        label = result.names.get(cls, str(cls))
        conf = float(box.conf[0])
        x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
        detections.append(
            {
                "label": label,
                "confidence": round(conf, 4),
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
            }
        )

    return annotated, detections


def expanded_crop(frame, detection, padding=0.18):
    height, width = frame.shape[:2]
    x1 = detection["x1"]
    y1 = detection["y1"]
    x2 = detection["x2"]
    y2 = detection["y2"]
    pad_x = int((x2 - x1) * padding)
    pad_y = int((y2 - y1) * padding)
    left = max(0, x1 - pad_x)
    top = max(0, y1 - pad_y)
    right = min(width, x2 + pad_x)
    bottom = min(height, y2 + pad_y)
    return frame[top:bottom, left:right], (left, top, right, bottom)


def seal_crops(frame, detections):
    crops = [
        expanded_crop(frame, detection)
        for detection in detections
        if "sello" in detection["label"].lower()
    ]
    return crops or [(frame, (0, 0, frame.shape[1], frame.shape[0]))]


def inspection_crops(frame, detections):
    crops = []
    seen = set()

    def add_crop(crop, box):
        if box in seen or crop.size == 0:
            return
        seen.add(box)
        crops.append((crop, box))

    for crop, box in seal_crops(frame, detections):
        add_crop(crop, box)

    height, width = frame.shape[:2]
    add_crop(frame, (0, 0, width, height))

    # Extra regions help when YOLO does not catch the seal but the label is visible.
    add_crop(frame[:, width // 3 :], (width // 3, 0, width, height))
    add_crop(frame[height // 4 : height * 3 // 4, :], (0, height // 4, width, height * 3 // 4))
    return crops


def qr_preprocessed_variants(image):
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY) if image.ndim == 3 else image
    blur = cv2.GaussianBlur(gray, (0, 0), 1.0)
    sharp = cv2.addWeighted(gray, 1.6, blur, -0.6, 0)
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    adaptive = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        5,
    )
    return [image, gray, cv2.equalizeHist(gray), sharp, otsu, adaptive]


def qr_variants(crop):
    variants = []
    height, width = crop.shape[:2]
    max_side = max(height, width)
    scales = [1.0, 2.0]
    if min(height, width) < 420:
        scales.append(max(3.0, 420 / max(1, min(height, width))))

    for scale in scales:
        if scale == 1.0:
            resized = crop
        else:
            resized = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

        variants.extend((variant, scale) for variant in qr_preprocessed_variants(resized))

        # Some phone/camera paths mirror frames; this keeps QR reading tolerant.
        if max_side < 900:
            variants.extend((variant, scale) for variant in qr_preprocessed_variants(cv2.flip(resized, 1)))

    return variants


def decode_qr_from_image(detector, image):
    decoded = []
    ok, decoded_info, points, _ = detector.detectAndDecodeMulti(image)
    if ok and decoded_info:
        point_sets = points if points is not None else [None] * len(decoded_info)
        decoded = [
            {"value": value, "points": point_set}
            for value, point_set in zip(decoded_info, point_sets)
            if value
        ]

    if not decoded:
        value, points, _ = detector.detectAndDecode(image)
        if value:
            decoded = [{"value": value, "points": points}]

    return decoded


def add_qr_value(values, value, box=None, source="opencv"):
    value = (value or "").strip()
    if not value or any(existing["value"] == value for existing in values):
        return

    values.append(
        {
            "value": value,
            "is_expected": value == EXPECTED_QR_URL,
            "box": box,
            "source": source,
        }
    )


def decode_qr_values(frame, detections, qr_hints=None):
    detector = cv2.QRCodeDetector()
    try:
        detector.setEpsX(0.4)
        detector.setEpsY(0.4)
    except Exception:
        pass
    values = []

    for hint in qr_hints or []:
        add_qr_value(values, hint, source="browser")

    for crop, (left, top, _, _) in inspection_crops(frame, detections):
        decoded = []
        for variant, scale in qr_variants(crop):
            decoded = decode_qr_from_image(detector, variant)
            if decoded:
                break

        for item in decoded:
            box = None
            points = item.get("points")
            if points is not None:
                pts = np.array(points).reshape(-1, 2)
                if scale != 1.0:
                    pts = pts / scale
                x1, y1 = np.min(pts, axis=0).astype(int)
                x2, y2 = np.max(pts, axis=0).astype(int)
                box = {
                    "x1": int(x1 + left),
                    "y1": int(y1 + top),
                    "x2": int(x2 + left),
                    "y2": int(y2 + top),
                }

            add_qr_value(values, item["value"], box=box)

    return values


def ocr_variants(crop):
    rotations = [
        cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE),
        crop,
        cv2.rotate(crop, cv2.ROTATE_90_COUNTERCLOCKWISE),
    ]
    variants = []

    for rotated in rotations:
        gray = cv2.cvtColor(rotated, cv2.COLOR_RGB2GRAY)
        gray = cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
        gray = cv2.bilateralFilter(gray, 7, 55, 55)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        equalized = clahe.apply(gray)
        blur = cv2.GaussianBlur(equalized, (0, 0), 1.0)
        sharp = cv2.addWeighted(equalized, 1.7, blur, -0.7, 0)
        _, otsu = cv2.threshold(sharp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.extend([equalized, sharp, otsu])

    return variants


def serial_focused_crops(frame, qr_codes):
    crops = []
    height, width = frame.shape[:2]

    for qr in qr_codes:
        box = qr.get("box") or {}
        try:
            x1 = int(box["x1"])
            y1 = int(box["y1"])
            x2 = int(box["x2"])
            y2 = int(box["y2"])
        except (KeyError, TypeError, ValueError):
            continue

        qr_w = max(1, x2 - x1)
        qr_h = max(1, y2 - y1)
        regions = [
            (
                max(0, x1 - int(qr_w * 0.8)),
                max(0, y1 - int(qr_h * 3.6)),
                min(width, x2 + int(qr_w * 2.1)),
                min(height, y2 + int(qr_h * 0.8)),
            ),
            (
                max(0, x1 - int(qr_w * 0.3)),
                max(0, y1 - int(qr_h * 3.2)),
                min(width, x2 + int(qr_w * 1.3)),
                min(height, y1 + int(qr_h * 0.5)),
            ),
        ]

        for left, top, right, bottom in regions:
            crop = frame[top:bottom, left:right]
            if crop.size:
                crops.append((crop, (left, top, right, bottom)))

    return crops


def normalize_serial_candidate(value):
    value = re.sub(r"[^A-Z0-9]", "", value.upper())
    value = value.replace(" ", "")
    if not value:
        return ""

    # The seal series commonly starts as 25C..., but OCR often reads C as U/O/0.
    value = re.sub(r"^25[UO0]([0-9])", r"25C\1", value)

    if value.startswith("25C"):
        head = "25C"
        tail = value[3:].translate(str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8"}))
        normalized = head + tail
        return normalized[:16] if len(normalized) > 16 else normalized

    return value


def series_candidates_from_text(text):
    clean = re.sub(r"[^A-Z0-9]", "", text.upper())
    raw_candidates = re.findall(r"[A-Z0-9]{8,}", clean)
    candidates = []

    for raw in raw_candidates:
        normalized = normalize_serial_candidate(raw)
        if not normalized:
            continue

        pattern_matches = re.findall(r"25[CUO0][A-Z0-9]{10,15}", normalized)
        candidates.extend(normalize_serial_candidate(item) for item in pattern_matches)
        candidates.append(normalized)

    return [
        item
        for item in candidates
        if 10 <= len(item) <= 18 and sum(char.isdigit() for char in item) >= 7
    ]


def is_strong_series_candidate(value):
    return value.startswith("25C") and 14 <= len(value) <= 18 and sum(char.isdigit() for char in value) >= 12


def extract_numeric_series(frame, detections, qr_codes=None):
    if pytesseract is None:
        return [], "", "Instala pytesseract para activar el OCR de la serie."

    texts = []
    candidates = []
    configs = [
        "--oem 3 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        "--oem 3 --psm 11 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ]

    try:
        crops = serial_focused_crops(frame, qr_codes or [])
        if not crops:
            crops = inspection_crops(frame, detections)

        for crop, _ in crops:
            if crop.size == 0:
                continue

            for processed in ocr_variants(crop):
                for config in configs:
                    text = pytesseract.image_to_string(processed, lang=OCR_LANG, config=config, timeout=4)
                    clean_text = re.sub(r"\s+", " ", text).strip()
                    if clean_text:
                        texts.append(clean_text)
                        new_candidates = series_candidates_from_text(clean_text)
                        candidates.extend(new_candidates)
                        if any(is_strong_series_candidate(candidate) for candidate in new_candidates):
                            unique_candidates = sorted(
                                set(candidates),
                                key=lambda value: (
                                    not value.startswith("25C"),
                                    abs(len(value) - 16),
                                    -sum(char.isdigit() for char in value),
                                    value,
                                ),
                            )
                            unique_texts = list(dict.fromkeys(texts))
                            return unique_candidates[:8], " | ".join(unique_texts[:8]), None
    except TesseractNotFoundError:
        return [], "", "Tesseract no esta instalado o no esta en el PATH."
    except RuntimeError as exc:
        if "Tesseract process timeout" not in str(exc):
            raise

    unique_candidates = sorted(
        set(candidates),
        key=lambda value: (
            not value.startswith("25C"),
            abs(len(value) - 16),
            -sum(char.isdigit() for char in value),
            value,
        ),
    )
    unique_texts = list(dict.fromkeys(texts))
    return unique_candidates[:8], " | ".join(unique_texts[:8]), None


def analyze_seal(image, detections, qr_hints=None, read_text=True):
    frame = np.array(image)
    qr_codes = decode_qr_values(frame, detections, qr_hints)
    if read_text:
        series, raw_text, ocr_error = extract_numeric_series(frame, detections, qr_codes)
    else:
        series = []
        raw_text = ""
        ocr_error = None
    qr_ok = any(qr["is_expected"] for qr in qr_codes)

    return {
        "expected_url": EXPECTED_QR_URL,
        "qr_codes": qr_codes,
        "qr_ok": qr_ok,
        "seal_status": "Sello correcto" if qr_ok else "Sello por verificar",
        "series": series,
        "raw_text": raw_text,
        "ocr_error": ocr_error,
        "text_checked": read_text,
    }


@app.get("/")
def index():
    detector = get_model()
    names = getattr(detector, "names", {})
    labels = [names[k] for k in sorted(names)] if isinstance(names, dict) else list(names)
    static_version = max(
        (BASE_DIR / "static" / "app.js").stat().st_mtime_ns,
        (BASE_DIR / "static" / "styles.css").stat().st_mtime_ns,
    )
    return render_template(
        "index.html",
        model_path=str(MODEL_PATH.relative_to(BASE_DIR) if MODEL_PATH.is_relative_to(BASE_DIR) else MODEL_PATH),
        labels=labels,
        confidence=CONFIDENCE_DEFAULT,
        static_version=static_version,
    )


@app.post("/api/detect")
def detect():
    try:
        payload = request.get_json(silent=True) or {}
        if request.form:
            payload = {**payload, **request.form.to_dict()}
        confidence = float(payload.get("confidence") or CONFIDENCE_DEFAULT)
        confidence = max(0.01, min(confidence, 0.99))
        return_annotated = request_bool(payload, "return_annotated", True)
        image = image_from_request()
        if not inference_lock.acquire(blocking=False):
            return jsonify({"ok": False, "error": "El detector esta ocupado. Intenta de nuevo en un momento."}), 429

        try:
            annotated, detections = run_detection(image, confidence, return_annotated)
            seal = None
            if request_bool(payload, "analyze_seal", True):
                seal = analyze_seal(
                    image,
                    detections,
                    payload.get("qr_codes") or [],
                    request_bool(payload, "read_text", True),
                )
        finally:
            inference_lock.release()

        return jsonify(
            {
                "ok": True,
                "detections": detections,
                "count": len(detections),
                "seal": seal,
                "annotated_image": f"data:image/jpeg;base64,{encode_image(annotated)}" if annotated is not None else None,
            }
        )
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.get("/api/mqtt")
def mqtt_status():
    return jsonify({"ok": True, "mqtt": mqtt_snapshot()})


@app.post("/api/mqtt/comando")
def mqtt_command():
    try:
        payload = request.get_json(silent=True) or {}
        command = str(payload.get("comando") or "").strip().lower()
        allowed = {"iniciar", "pausar", "reanudar", "detener", "reset", "mover_banda", "mover_carrusel", "girar_base"}
        if command not in allowed:
            raise ValueError("Comando MQTT no valido.")

        message = {"comando": command}
        publish_mqtt("corona/comandos", message)
        update_mqtt_topic("corona/comandos", message)
        return jsonify({"ok": True, "comando": command})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/mqtt/ia")
def mqtt_ai_result():
    try:
        payload = request.get_json(silent=True) or {}
        result = str(payload.get("resultado") or "").strip().lower()
        if result not in {"normal", "adulterada"}:
            raise ValueError("Resultado IA no valido.")

        confidence = float(payload.get("confianza") or 0)
        confidence = max(0.0, min(confidence, 1.0))
        message = {
            "resultado": result,
            "confianza": round(confidence, 4),
        }
        detail = str(payload.get("detalle") or "").strip()
        if detail:
            message["detalle"] = detail[:80]

        publish_mqtt("corona/ia", message)
        update_mqtt_topic("corona/ia", message)
        return jsonify({"ok": True, "ia": message})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


def main():
    parser = argparse.ArgumentParser(description="Aplicacion Flask para deteccion con YOLO.")
    parser.add_argument(
        "--serve",
        action="store_true",
        help="Inicia el servidor web local.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host del servidor.")
    parser.add_argument("--port", type=int, default=5000, help="Puerto del servidor.")
    args = parser.parse_args()

    if not args.serve:
        print("Servidor no iniciado. Usa: python app.py --serve")
        return

    start_mqtt_client()
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
