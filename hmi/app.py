#!/usr/bin/env python3
import argparse
import json
import mimetypes
import os
import queue
import sqlite3
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = BASE_DIR / "hmi_eventos.sqlite3"
MODEL_PATH = BASE_DIR.parent / "hmi_old" / "models" / "best.pt"
TOPIC_DEFAULT = "cheve"
MODELO_CONFIDENCE_DEFAULT = 0.35
MODELO_CAMERA_DEFAULT = 0

try:
    import paho.mqtt.client as mqtt
except ModuleNotFoundError:
    mqtt = None

os.environ.setdefault("YOLO_CONFIG_DIR", str(BASE_DIR / ".ultralytics"))
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

try:
    import cv2
    from ultralytics import YOLO
except ImportError:
    cv2 = None
    YOLO = None

state_lock = threading.Lock()
subscribers_lock = threading.Lock()
subscribers: list[queue.Queue] = []
mqtt_bridge = None

estado = {
    "mqtt": {
        "enabled": True,
        "connected": False,
        "broker": "127.0.0.1",
        "port": 1883,
        "topic": TOPIC_DEFAULT,
        "error": None,
    },
    "banda": {
        "activa": False,
        "evento": "detiene",
        "actualizadoMs": None,
    },
    "giro": {
        "activo": False,
        "evento": "detiene",
        "actualizadoMs": None,
    },
    "alcohol": {
        "mq4_1": {"valor": None, "unidad": "ppm", "actualizadoMs": None},
        "mq4_2": {"valor": None, "unidad": "ppm", "actualizadoMs": None},
    },
    "sensores": {
        "inicio": {"detecta": False, "evento": "libera", "actualizadoMs": None},
        "fin": {"detecta": False, "evento": "libera", "actualizadoMs": None},
    },
    "modelo": {
        "activo": False,
        "error": None,
        "camara": MODELO_CAMERA_DEFAULT,
        "modelo": str(MODEL_PATH),
        "detecciones": [],
        "qrDetectado": False,
        "actualizadoMs": None,
    },
    "ultimoEvento": None,
    "eventos": [],
}


def conectar_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def iniciar_db() -> None:
    with conectar_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS eventos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              topic TEXT NOT NULL,
              payload TEXT NOT NULL,
              recibido_ms INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_eventos_id ON eventos(id DESC)"
        )


def guardar_evento(topic: str, payload: dict, recibido_ms: int) -> int:
    with conectar_db() as conn:
        cursor = conn.execute(
            "INSERT INTO eventos (topic, payload, recibido_ms) VALUES (?, ?, ?)",
            (topic, json.dumps(payload, separators=(",", ":")), recibido_ms),
        )
        return int(cursor.lastrowid)


def cargar_eventos(before_id: int | None = None, limit: int = 40) -> list[dict]:
    query = "SELECT id, topic, payload, recibido_ms FROM eventos"
    params: list[int] = []

    if before_id is not None:
        query += " WHERE id < ?"
        params.append(before_id)

    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    with conectar_db() as conn:
        rows = conn.execute(query, params).fetchall()

    return [
        {
            "id": row["id"],
            "topic": row["topic"],
            "payload": json.loads(row["payload"]),
            "recibidoMs": row["recibido_ms"],
        }
        for row in rows
    ]


def ahora_ms() -> int:
    return int(time.time() * 1000)


def snapshot() -> dict:
    with state_lock:
        return json.loads(json.dumps(estado))


def publicar_sse() -> None:
    carga = snapshot()
    with subscribers_lock:
        for subscriber in list(subscribers):
            try:
                subscriber.put_nowait(carga)
            except queue.Full:
                pass


def registrar_evento(topic: str, payload: dict) -> None:
    recibido_ms = ahora_ms()
    evento_id = guardar_evento(topic, payload, recibido_ms)
    entrada = {
        "id": evento_id,
        "topic": topic,
        "payload": payload,
        "recibidoMs": recibido_ms,
    }

    with state_lock:
        estado["ultimoEvento"] = entrada
        estado["eventos"].insert(0, entrada)
        estado["eventos"] = estado["eventos"][:40]

        tipo = payload.get("tipo")
        if tipo == "banda":
            estado["banda"]["activa"] = bool(payload.get("activa", False))
            estado["banda"]["evento"] = str(payload.get("evento", ""))
            estado["banda"]["actualizadoMs"] = recibido_ms
        elif tipo == "sensor_infrarrojo":
            sensor = str(payload.get("sensor", ""))
            if sensor in estado["sensores"]:
                estado["sensores"][sensor]["detecta"] = bool(payload.get("detecta", False))
                estado["sensores"][sensor]["evento"] = str(payload.get("evento", ""))
                estado["sensores"][sensor]["actualizadoMs"] = recibido_ms
        elif tipo == "mq4":
            sensor = str(payload.get("sensor", ""))
            if sensor in estado["alcohol"]:
                estado["alcohol"][sensor]["valor"] = payload.get("valor")
                estado["alcohol"][sensor]["unidad"] = str(payload.get("unidad", "ppm"))
                estado["alcohol"][sensor]["actualizadoMs"] = recibido_ms
        elif tipo == "evento":
            evento = str(payload.get("evento", ""))
            if evento == "giro_botella_inicia":
                estado["giro"]["activo"] = True
                estado["giro"]["evento"] = "inicia"
                estado["giro"]["actualizadoMs"] = recibido_ms
            elif evento == "giro_botella_detiene":
                estado["giro"]["activo"] = False
                estado["giro"]["evento"] = "detiene"
                estado["giro"]["actualizadoMs"] = recibido_ms
            elif evento == "qr_detectado":
                estado["modelo"]["qrDetectado"] = True
                estado["modelo"]["actualizadoMs"] = recibido_ms
        elif tipo == "modelo":
            estado["modelo"]["detecciones"] = payload.get("detecciones", [])
            estado["modelo"]["qrDetectado"] = bool(payload.get("qrDetectado", False))
            estado["modelo"]["actualizadoMs"] = recibido_ms

    publicar_sse()


def parse_payload(raw_payload: bytes) -> dict:
    texto = raw_payload.decode("utf-8", errors="replace").strip()
    if not texto:
        return {"tipo": "evento", "evento": "mensaje_vacio", "detalle": ""}

    try:
        payload = json.loads(texto)
    except json.JSONDecodeError:
        return {"tipo": "evento", "evento": "mensaje_texto", "detalle": texto}

    if isinstance(payload, dict):
        return payload

    return {"tipo": "evento", "evento": "mensaje_json", "detalle": payload}


class MqttBridge:
    def __init__(self, host: str, port: int, topic: str, enabled: bool):
        self.host = host
        self.port = port
        self.topic = topic
        self.enabled = enabled
        self.client = None

        with state_lock:
            estado["mqtt"]["enabled"] = enabled
            estado["mqtt"]["broker"] = host
            estado["mqtt"]["port"] = port
            estado["mqtt"]["topic"] = topic
            if enabled and mqtt is None:
                estado["mqtt"]["error"] = "Instala paho-mqtt para recibir MQTT."

    def start(self) -> None:
        if not self.enabled or mqtt is None:
            publicar_sse()
            return

        self.client = mqtt.Client(client_id="hmi-cheve")
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message
        self.client.reconnect_delay_set(min_delay=1, max_delay=15)
        self.client.connect_async(self.host, self.port, keepalive=30)
        self.client.loop_start()

    def publish(self, payload: dict) -> bool:
        if not self.enabled or self.client is None or not self.client.is_connected():
            return False

        message = json.dumps(payload, separators=(",", ":"))
        result = self.client.publish(self.topic, message, qos=0, retain=False)
        return int(result.rc) == 0

    def on_connect(self, client, userdata, flags, rc):
        conectado = int(rc) == 0
        with state_lock:
            estado["mqtt"]["connected"] = conectado
            estado["mqtt"]["error"] = None if conectado else f"MQTT rc={rc}"
        if conectado:
            client.subscribe(self.topic)
        publicar_sse()

    def on_disconnect(self, client, userdata, rc):
        with state_lock:
            estado["mqtt"]["connected"] = False
            estado["mqtt"]["error"] = None if int(rc) == 0 else f"Desconectado rc={rc}"
        publicar_sse()

    def on_message(self, client, userdata, message):
        registrar_evento(message.topic, parse_payload(message.payload))


class DetectorModelo:
    def __init__(self):
        self.lock = threading.Lock()
        self.frame_lock = threading.Lock()
        self.thread = None
        self.stop_event = threading.Event()
        self.modelo = None
        self.ultimo_frame = None
        self.qr_publicado = False
        self.confidence = MODELO_CONFIDENCE_DEFAULT
        self.camera_index = MODELO_CAMERA_DEFAULT

    def activo(self) -> bool:
        return self.thread is not None and self.thread.is_alive()

    def iniciar(self, camera_index: int = MODELO_CAMERA_DEFAULT,
                confidence: float = MODELO_CONFIDENCE_DEFAULT) -> tuple[bool, str]:
        with self.lock:
            if self.activo():
                return True, "El modelo ya esta activo."

            if cv2 is None or YOLO is None:
                return False, "Falta cv2 o ultralytics en este entorno."

            if not MODEL_PATH.is_file():
                return False, f"No se encontro el modelo: {MODEL_PATH}"

            self.camera_index = camera_index
            self.confidence = max(0.01, min(float(confidence), 0.99))
            self.stop_event.clear()
            self.qr_publicado = False
            self.thread = threading.Thread(target=self.ejecutar, daemon=True)
            self.thread.start()

            with state_lock:
                estado["modelo"]["activo"] = True
                estado["modelo"]["error"] = None
                estado["modelo"]["camara"] = camera_index
                estado["modelo"]["qrDetectado"] = False
                estado["modelo"]["actualizadoMs"] = ahora_ms()
            publicar_sse()
            return True, "Modelo iniciado."

    def detener(self) -> None:
        self.stop_event.set()
        with state_lock:
            estado["modelo"]["activo"] = False
            estado["modelo"]["actualizadoMs"] = ahora_ms()
        publicar_sse()

    def cargar_modelo(self):
        if self.modelo is None:
            self.modelo = YOLO(str(MODEL_PATH))
        return self.modelo

    def actualizar_estado(self, detecciones: list[dict], qr_detectado: bool,
                          error: str | None = None) -> None:
        with state_lock:
            estado["modelo"]["activo"] = self.activo() and error is None
            estado["modelo"]["error"] = error
            estado["modelo"]["detecciones"] = detecciones
            estado["modelo"]["qrDetectado"] = qr_detectado
            estado["modelo"]["actualizadoMs"] = ahora_ms()
        publicar_sse()

    def publicar_qr_detectado(self, detecciones: list[dict]) -> None:
        if self.qr_publicado:
            return

        self.qr_publicado = True
        payload = {
            "tipo": "evento",
            "evento": "qr_detectado",
            "detalle": "modelo_yolo",
            "cantidadDetecciones": len(detecciones),
            "tiempoMs": ahora_ms(),
        }

        publicado = bool(mqtt_bridge and mqtt_bridge.publish(payload))
        if not publicado:
            registrar_evento(TOPIC_DEFAULT, payload)

    def ejecutar(self) -> None:
        cap = None
        try:
            detector = self.cargar_modelo()
            cap = cv2.VideoCapture(self.camera_index)
            if not cap.isOpened():
                raise RuntimeError(f"No se pudo abrir la camara {self.camera_index}.")

            while not self.stop_event.is_set():
                ok, frame = cap.read()
                if not ok:
                    raise RuntimeError("No se pudo leer la camara.")

                result = detector.predict(
                    frame,
                    conf=self.confidence,
                    imgsz=640,
                    verbose=False,
                )[0]

                detecciones = []
                for box in result.boxes:
                    cls = int(box.cls[0])
                    etiqueta = str(result.names.get(cls, cls))
                    confianza = float(box.conf[0])
                    x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                    detecciones.append(
                        {
                            "etiqueta": etiqueta,
                            "confianza": round(confianza, 4),
                            "x1": x1,
                            "y1": y1,
                            "x2": x2,
                            "y2": y2,
                        }
                    )

                qr_detectado = any("qr" in item["etiqueta"].lower() for item in detecciones)
                anotado = result.plot()
                ok_encode, buffer = cv2.imencode(".jpg", anotado)
                if ok_encode:
                    with self.frame_lock:
                        self.ultimo_frame = buffer.tobytes()

                self.actualizar_estado(detecciones, qr_detectado)
                if qr_detectado:
                    self.publicar_qr_detectado(detecciones)

                time.sleep(0.12)
        except Exception as exc:
            self.actualizar_estado([], False, str(exc))
        finally:
            if cap is not None:
                cap.release()
            with state_lock:
                estado["modelo"]["activo"] = False
                estado["modelo"]["actualizadoMs"] = ahora_ms()
            publicar_sse()

    def frame(self) -> bytes | None:
        with self.frame_lock:
            return self.ultimo_frame


detector_modelo = DetectorModelo()


class HmiHandler(BaseHTTPRequestHandler):
    server_version = "CheveHMI/1.0"

    def log_message(self, format, *args):
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        ruta = parsed.path
        if ruta == "/":
            self.serve_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
        elif ruta == "/explorer":
            self.serve_file(STATIC_DIR / "explorer.html", "text/html; charset=utf-8")
        elif ruta == "/api/state":
            self.send_json(snapshot())
        elif ruta == "/api/events":
            self.send_json(self.leer_eventos_api(parsed.query))
        elif ruta == "/api/modelo/frame":
            self.serve_model_frame()
        elif ruta == "/events":
            self.serve_events()
        elif ruta.startswith("/static/"):
            rel = ruta.removeprefix("/static/")
            self.serve_file(STATIC_DIR / rel)
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "No encontrado")

    def do_POST(self):
        parsed = urlparse(self.path)
        ruta = parsed.path

        if ruta == "/api/modelo/iniciar":
            self.iniciar_modelo()
        elif ruta == "/api/modelo/detener":
            detector_modelo.detener()
            self.send_json({"ok": True})
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "No encontrado")

    def leer_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}

        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

        return data if isinstance(data, dict) else {}

    def iniciar_modelo(self) -> None:
        payload = self.leer_json()
        try:
            camara = int(payload.get("camara", MODELO_CAMERA_DEFAULT))
        except (TypeError, ValueError):
            camara = MODELO_CAMERA_DEFAULT

        try:
            confianza = float(payload.get("confianza", MODELO_CONFIDENCE_DEFAULT))
        except (TypeError, ValueError):
            confianza = MODELO_CONFIDENCE_DEFAULT

        ok, mensaje = detector_modelo.iniciar(camara, confianza)
        self.send_json({"ok": ok, "mensaje": mensaje})

    def leer_eventos_api(self, query: str) -> dict:
        params = parse_qs(query)
        before_id = None

        if params.get("before_id"):
            try:
                before_id = int(params["before_id"][0])
            except ValueError:
                before_id = None

        try:
            limit = min(max(int(params.get("limit", ["40"])[0]), 1), 100)
        except ValueError:
            limit = 40

        eventos = cargar_eventos(before_id=before_id, limit=limit)
        return {"eventos": eventos, "hasMore": len(eventos) == limit}

    def send_json(self, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, path: Path, content_type: str | None = None) -> None:
        path = path.resolve()
        if not path.is_file() or not str(path).startswith(str(STATIC_DIR.resolve())):
            self.send_error(HTTPStatus.NOT_FOUND, "No encontrado")
            return

        body = path.read_bytes()
        tipo = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def serve_model_frame(self) -> None:
        frame = detector_modelo.frame()
        if frame is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Sin frame del modelo")
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(frame)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(frame)

    def serve_events(self) -> None:
        subscriber = queue.Queue(maxsize=10)
        with subscribers_lock:
            subscribers.append(subscriber)

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        try:
            self.write_event(snapshot())
            while True:
                try:
                    payload = subscriber.get(timeout=20)
                    self.write_event(payload)
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with subscribers_lock:
                if subscriber in subscribers:
                    subscribers.remove(subscriber)

    def write_event(self, payload: dict) -> None:
        data = json.dumps(payload, separators=(",", ":"))
        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
        self.wfile.flush()


def crear_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="HMI web para la linea Cheve.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8080, type=int)
    parser.add_argument("--mqtt-host", default="127.0.0.1")
    parser.add_argument("--mqtt-port", default=1883, type=int)
    parser.add_argument("--mqtt-topic", default=TOPIC_DEFAULT)
    parser.add_argument("--no-mqtt", action="store_true")
    return parser


def main() -> None:
    global mqtt_bridge
    args = crear_parser().parse_args()
    iniciar_db()
    with state_lock:
        estado["eventos"] = cargar_eventos(limit=40)
        estado["ultimoEvento"] = estado["eventos"][0] if estado["eventos"] else None

    bridge = MqttBridge(
        args.mqtt_host,
        args.mqtt_port,
        args.mqtt_topic,
        enabled=not args.no_mqtt,
    )
    mqtt_bridge = bridge
    bridge.start()

    servidor = ThreadingHTTPServer((args.host, args.port), HmiHandler)
    print(f"HMI disponible en http://{args.host}:{args.port}")
    print(f"MQTT topic: {args.mqtt_topic} @ {args.mqtt_host}:{args.mqtt_port}")
    servidor.serve_forever()


if __name__ == "__main__":
    main()
