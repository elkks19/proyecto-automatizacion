#pragma once

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>

class PublicadorEventosMqtt {
public:
  PublicadorEventosMqtt(const char *ssid, const char *contrasenaWifi,
                        const char *servidorMqtt, uint16_t puertoMqtt,
                        const char *clienteId, const char *topicoEventos);

  void iniciarConfiguracion();
  void actualizar();
  void mantenerConexion();
  bool consumirQrDetectado();
  bool publicarEvento(const char *evento, const char *detalle = "");
  bool publicarEventoSensorInfrarrojo(const char *sensor, bool detectaAlgo);
  bool publicarEventoBanda(bool estaActiva);
  bool estaConectado();

private:
  static PublicadorEventosMqtt *instanciaActiva_;
  static void recibirMensajeMqtt(char *topico, uint8_t *payload,
                                 unsigned int longitud);

  void procesarMensajeMqtt(char *topico, uint8_t *payload,
                           unsigned int longitud);
  void conectarWifi();
  void reconectarMqttSiHaceFalta();
  bool publicarMensaje(const String &mensaje);

  const char *ssid_;
  const char *contrasenaWifi_;
  const char *servidorMqtt_;
  uint16_t puertoMqtt_;
  const char *clienteId_;
  const char *topicoEventos_;

  WiFiClient clienteWifi_;
  PubSubClient clienteMqtt_;
  unsigned long ultimoIntentoConexionMs_ = 0;
  const unsigned long intervaloReconexionMs_ = 5000;
  bool qrDetectado_ = false;
};
