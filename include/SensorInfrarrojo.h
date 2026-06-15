#pragma once

#include <Arduino.h>

class SensorInfrarrojo {
public:
  SensorInfrarrojo(uint8_t pinSenal, bool activoEnBajo = true,
                   uint8_t modoPin = INPUT);

  void iniciarConfiguracion();
  bool detectaAlgo() const;

private:
  uint8_t pinSenal_;
  bool activoEnBajo_;
  uint8_t modoPin_;
};
