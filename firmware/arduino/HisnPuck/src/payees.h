#pragma once
#include <Arduino.h>

struct Payee {
  uint8_t address[20];
  char label[17];
  bool active;
};

void payeesLoad();
int payeeCount();
const Payee *payeeAt(int i);
const Payee *payeeFind(const uint8_t a[20], bool activeOnly);
bool payeePut(const uint8_t a[20], const char *label, bool active);
bool payeeActivate(const uint8_t a[20]);
bool payeeRemove(const uint8_t a[20]);
