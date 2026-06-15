#include "Motor.h"

Motor::Motor(uint8_t pinPaso, uint8_t pinDireccion, unsigned long tiempoAltoMs,
             unsigned long periodoPasoMs)
    : pinPaso_(pinPaso),
      pinDireccion_(pinDireccion),
      tiempoAltoMs_(tiempoAltoMs),
      periodoPasoMs_(periodoPasoMs) {}

void Motor::iniciarConfiguracion(bool sentidoHorario) {
  pinMode(pinPaso_, OUTPUT);
  pinMode(pinDireccion_, OUTPUT);

  digitalWrite(pinPaso_, LOW);
  cambiarSentido(sentidoHorario);
  detener();
}

void Motor::iniciar() {
  if (estaActivo_) {
    movimientoLimitado_ = false;
    return;
  }

  estaActivo_ = true;
  movimientoLimitado_ = false;
}

void Motor::detener() {
  estaActivo_ = false;
  movimientoLimitado_ = false;
  pulsoAlto_ = false;
  digitalWrite(pinPaso_, LOW);
}

bool Motor::estaActivo() const {
  return estaActivo_;
}

void Motor::cambiarSentido(bool sentidoHorario) {
  digitalWrite(pinDireccion_, sentidoHorario ? HIGH : LOW);
}

void Motor::ejecutarPulsos() {
  const unsigned long tiempoActualMs = millis();

  if (pulsoAlto_ && debeFinalizarPulso(tiempoActualMs)) {
    finalizarPulso();
  }

  if (!estaActivo_ || pulsoAlto_ || !puedeIniciarPaso(tiempoActualMs)) {
    return;
  }

  if (movimientoLimitado_ && pasosRestantes_ == 0) {
    detener();
    return;
  }

  iniciarPulso(tiempoActualMs);

  if (movimientoLimitado_) {
    --pasosRestantes_;
  }
}

void Motor::darPaso() {
  iniciar();
  ejecutarPulsos();
}

void Motor::moverPasos(unsigned long pasos) {
  pasosRestantes_ = pasos;
  movimientoLimitado_ = true;

  if (pasos > 0) {
    iniciar();
    movimientoLimitado_ = true;
  } else {
    detener();
  }
}

bool Motor::puedeIniciarPaso(unsigned long tiempoActualMs) const {
  return tiempoActualMs - ultimoPasoMs_ >= periodoPasoMs_;
}

bool Motor::debeFinalizarPulso(unsigned long tiempoActualMs) const {
  return tiempoActualMs - ultimoPasoMs_ >= tiempoAltoMs_;
}

void Motor::iniciarPulso(unsigned long tiempoActualMs) {
  digitalWrite(pinPaso_, HIGH);
  ultimoPasoMs_ = tiempoActualMs;
  pulsoAlto_ = true;
}

void Motor::finalizarPulso() {
  digitalWrite(pinPaso_, LOW);
  pulsoAlto_ = false;
}
