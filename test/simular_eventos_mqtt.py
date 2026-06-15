#!/usr/bin/env python3
"""Simula los eventos MQTT enviados por el NodeMCU para probar el HMI."""

import argparse
import json
import time
from typing import Any

try:
    import paho.mqtt.client as mqtt
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Falta instalar paho-mqtt. Ejecuta: python3 -m pip install -r requirements.txt"
    ) from exc


def tiempo_ms(inicio: float) -> int:
    return int((time.monotonic() - inicio) * 1000)


def evento_sensor(sensor: str, detecta: bool, inicio: float) -> dict[str, Any]:
    return {
        "tipo": "sensor_infrarrojo",
        "sensor": sensor,
        "evento": "detecta" if detecta else "libera",
        "detecta": detecta,
        "tiempoMs": tiempo_ms(inicio),
    }


def evento_banda(activa: bool, inicio: float) -> dict[str, Any]:
    return {
        "tipo": "banda",
        "evento": "inicia" if activa else "detiene",
        "activa": activa,
        "tiempoMs": tiempo_ms(inicio),
    }


def evento_generico(evento: str, inicio: float, detalle: str = "") -> dict[str, Any]:
    return {
        "tipo": "evento",
        "evento": evento,
        "detalle": detalle,
        "tiempoMs": tiempo_ms(inicio),
    }


def evento_mq4(sensor: str, valor: float, inicio: float) -> dict[str, Any]:
    return {
        "tipo": "mq4",
        "sensor": sensor,
        "valor": valor,
        "unidad": "ppm",
        "tiempoMs": tiempo_ms(inicio),
    }


def publicar(cliente: mqtt.Client, topico: str, mensaje: dict[str, Any]) -> None:
    carga = json.dumps(mensaje, separators=(",", ":"))
    resultado = cliente.publish(topico, carga)
    resultado.wait_for_publish()
    print(f"{topico} {carga}")


def escenario_ciclo(cliente: mqtt.Client, topico: str, pausa: float) -> None:
    inicio = time.monotonic()
    mensajes = [
        evento_sensor("inicio", True, inicio),
        evento_mq4("mq4_1", 18.0, inicio),
        evento_mq4("mq4_2", 20.5, inicio),
        evento_banda(True, inicio),
        evento_mq4("mq4_1", 24.2, inicio),
        evento_mq4("mq4_2", 28.7, inicio),
        evento_sensor("inicio", False, inicio),
        evento_mq4("mq4_1", 31.4, inicio),
        evento_mq4("mq4_2", 33.1, inicio),
        evento_sensor("fin", True, inicio),
        evento_banda(False, inicio),
        evento_generico("espera_giro_botella", inicio),
        evento_mq4("mq4_1", 35.8, inicio),
        evento_mq4("mq4_2", 39.3, inicio),
        evento_generico("giro_botella_inicia", inicio),
        evento_mq4("mq4_1", 37.0, inicio),
        evento_mq4("mq4_2", 41.6, inicio),
        evento_generico("qr_detectado", inicio, "modelo_yolo"),
        evento_generico("giro_botella_detiene", inicio, "qr_detectado"),
        evento_sensor("fin", False, inicio),
    ]

    for mensaje in mensajes:
        publicar(cliente, topico, mensaje)
        time.sleep(pausa)


def publicar_manual(cliente: mqtt.Client, topico: str, args: argparse.Namespace) -> None:
    inicio = time.monotonic()

    if args.tipo == "sensor":
        mensaje = evento_sensor(args.sensor, args.detecta, inicio)
    elif args.tipo == "banda":
        mensaje = evento_banda(args.activa, inicio)
    elif args.tipo == "mq4":
        mensaje = evento_mq4(args.sensor, args.valor, inicio)
    else:
        mensaje = evento_generico(args.evento, inicio, args.detalle)

    publicar(cliente, topico, mensaje)


def crear_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Publica eventos MQTT con el mismo formato del firmware."
    )
    parser.add_argument("--host", default="127.0.0.1", help="Broker MQTT.")
    parser.add_argument("--port", default=1883, type=int, help="Puerto MQTT.")
    parser.add_argument("--topic", default="cheve", help="Topico MQTT.")
    parser.add_argument(
        "--client-id", default="simulador-hmi", help="Client ID MQTT."
    )
    parser.add_argument(
        "--pause", default=3.0, type=float, help="Pausa entre eventos del ciclo."
    )

    subparsers = parser.add_subparsers(dest="tipo")

    sensor = subparsers.add_parser("sensor", help="Publica un evento de sensor.")
    sensor.add_argument("sensor", choices=["inicio", "fin"])
    sensor.add_argument("estado", choices=["detecta", "libera"])
    sensor.set_defaults(detecta=lambda args: args.estado == "detecta")

    banda = subparsers.add_parser("banda", help="Publica un evento de banda.")
    banda.add_argument("estado", choices=["inicia", "detiene"])
    banda.set_defaults(activa=lambda args: args.estado == "inicia")

    mq4 = subparsers.add_parser("mq4", help="Publica una lectura MQ4.")
    mq4.add_argument("sensor", choices=["mq4_1", "mq4_2"])
    mq4.add_argument("valor", type=float)

    evento = subparsers.add_parser("evento", help="Publica un evento generico.")
    evento.add_argument("evento")
    evento.add_argument("--detalle", default="")

    qr = subparsers.add_parser("qr", help="Publica la senal del modelo.")
    qr.set_defaults(evento="qr_detectado", detalle="modelo_yolo")

    subparsers.add_parser("ciclo", help="Publica un ciclo completo de la banda.")
    parser.set_defaults(tipo="ciclo")
    return parser


def normalizar_args(args: argparse.Namespace) -> argparse.Namespace:
    if callable(getattr(args, "detecta", None)):
        args.detecta = args.detecta(args)

    if callable(getattr(args, "activa", None)):
        args.activa = args.activa(args)

    return args


def crear_cliente(client_id: str) -> mqtt.Client:
    if hasattr(mqtt, "CallbackAPIVersion"):
        return mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)

    return mqtt.Client(client_id=client_id)


def main() -> None:
    parser = crear_parser()
    args = normalizar_args(parser.parse_args())

    cliente = crear_cliente(args.client_id)
    cliente.connect(args.host, args.port, keepalive=60)
    cliente.loop_start()

    try:
        if args.tipo == "ciclo":
            escenario_ciclo(cliente, args.topic, args.pause)
        else:
            publicar_manual(cliente, args.topic, args)
    finally:
        cliente.loop_stop()
        cliente.disconnect()


if __name__ == "__main__":
    main()
