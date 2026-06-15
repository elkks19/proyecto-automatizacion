#include "PublicadorEventosMqtt.h"

PublicadorEventosMqtt *PublicadorEventosMqtt::instanciaActiva_ = nullptr;

PublicadorEventosMqtt::PublicadorEventosMqtt(
    const char *ssid, const char *contrasenaWifi, const char *servidorMqtt,
    uint16_t puertoMqtt, const char *clienteId, const char *topicoEventos)
    : ssid_(ssid),
      contrasenaWifi_(contrasenaWifi),
      servidorMqtt_(servidorMqtt),
      puertoMqtt_(puertoMqtt),
      clienteId_(clienteId),
      topicoEventos_(topicoEventos),
      clienteMqtt_(clienteWifi_) {}

void PublicadorEventosMqtt::iniciarConfiguracion() {
  instanciaActiva_ = this;
  WiFi.mode(WIFI_STA);
  conectarWifi();
  clienteMqtt_.setServer(servidorMqtt_, puertoMqtt_);
  clienteMqtt_.setBufferSize(512);
  clienteMqtt_.setCallback(PublicadorEventosMqtt::recibirMensajeMqtt);
}

void PublicadorEventosMqtt::actualizar() {
  mantenerConexion();
}

void PublicadorEventosMqtt::mantenerConexion() {
  if (WiFi.status() != WL_CONNECTED) {
    conectarWifi();
    return;
  }

  reconectarMqttSiHaceFalta();
  clienteMqtt_.loop();
}

bool PublicadorEventosMqtt::consumirQrDetectado() {
  const bool qrDetectado = qrDetectado_;
  qrDetectado_ = false;
  return qrDetectado;
}

bool PublicadorEventosMqtt::publicarEvento(const char *evento,
                                           const char *detalle) {
  const String mensaje =
      String("{\"tipo\":\"evento\",\"evento\":\"") + evento +
      "\",\"detalle\":\"" + detalle + "\",\"tiempoMs\":" +
      String(millis()) + "}";

  return publicarMensaje(mensaje);
}

bool PublicadorEventosMqtt::publicarEventoSensorInfrarrojo(
    const char *sensor, bool detectaAlgo) {
  const String mensaje =
      String("{\"tipo\":\"sensor_infrarrojo\",\"sensor\":\"") + sensor +
      "\",\"evento\":\"" + (detectaAlgo ? "detecta" : "libera") +
      "\",\"detecta\":" + (detectaAlgo ? "true" : "false") +
      ",\"tiempoMs\":" + String(millis()) + "}";

  return publicarMensaje(mensaje);
}

bool PublicadorEventosMqtt::publicarEventoBanda(bool estaActiva) {
  const String mensaje =
      String("{\"tipo\":\"banda\",\"evento\":\"") +
      (estaActiva ? "inicia" : "detiene") + "\",\"activa\":" +
      (estaActiva ? "true" : "false") + ",\"tiempoMs\":" +
      String(millis()) + "}";

  return publicarMensaje(mensaje);
}

bool PublicadorEventosMqtt::publicarMensaje(const String &mensaje) {
  if (!estaConectado()) {
    return false;
  }

  return clienteMqtt_.publish(topicoEventos_, mensaje.c_str());
}

bool PublicadorEventosMqtt::estaConectado() {
  return WiFi.status() == WL_CONNECTED && clienteMqtt_.connected();
}

void PublicadorEventosMqtt::recibirMensajeMqtt(char *topico, uint8_t *payload,
                                               unsigned int longitud) {
  if (instanciaActiva_ != nullptr) {
    instanciaActiva_->procesarMensajeMqtt(topico, payload, longitud);
  }
}

void PublicadorEventosMqtt::procesarMensajeMqtt(char *topico, uint8_t *payload,
                                                unsigned int longitud) {
  String mensaje;
  mensaje.reserve(longitud + 1);
  for (unsigned int i = 0; i < longitud; i++) {
    mensaje += static_cast<char>(payload[i]);
  }

  if (String(topico) == topicoEventos_ &&
      mensaje.indexOf("\"evento\":\"qr_detectado\"") >= 0) {
    qrDetectado_ = true;
  }
}

void PublicadorEventosMqtt::conectarWifi() {
  const unsigned long tiempoActualMs = millis();

  if (WiFi.status() == WL_CONNECTED ||
      tiempoActualMs - ultimoIntentoConexionMs_ < intervaloReconexionMs_) {
    return;
  }

  ultimoIntentoConexionMs_ = tiempoActualMs;
  WiFi.begin(ssid_, contrasenaWifi_);
}

void PublicadorEventosMqtt::reconectarMqttSiHaceFalta() {
  const unsigned long tiempoActualMs = millis();

  if (clienteMqtt_.connected() ||
      tiempoActualMs - ultimoIntentoConexionMs_ < intervaloReconexionMs_) {
    return;
  }

  ultimoIntentoConexionMs_ = tiempoActualMs;
  if (clienteMqtt_.connect(clienteId_)) {
    clienteMqtt_.subscribe(topicoEventos_);
  }
}
