#include "payees.h"
#include <Preferences.h>

static const int MAX_PAYEES = 20;
static Payee list[MAX_PAYEES];
static int count = 0;
static Preferences pp;

static void save() {
  pp.begin("hisnpay", false);
  pp.putInt("n", count);
  pp.putBytes("list", list, sizeof(Payee) * count);
  pp.end();
}

void payeesLoad() {
  pp.begin("hisnpay", true);
  count = pp.getInt("n", 0);
  if (count < 0 || count > MAX_PAYEES) count = 0;
  if (count && pp.getBytes("list", list, sizeof(Payee) * count) != sizeof(Payee) * count) count = 0;
  pp.end();
}

int payeeCount() {
  return count;
}

const Payee *payeeAt(int i) {
  return i >= 0 && i < count ? &list[i] : nullptr;
}

const Payee *payeeFind(const uint8_t a[20], bool activeOnly) {
  for (int i = 0; i < count; i++)
    if (memcmp(list[i].address, a, 20) == 0 && (!activeOnly || list[i].active)) return &list[i];
  return nullptr;
}

bool payeePut(const uint8_t a[20], const char *label, bool active) {
  Payee *p = const_cast<Payee *>(payeeFind(a, false));
  if (!p) {
    if (count >= MAX_PAYEES) return false;
    p = &list[count++];
    memcpy(p->address, a, 20);
  }
  strncpy(p->label, label, 16);
  p->label[16] = 0;
  p->active = active;
  save();
  return true;
}

bool payeeActivate(const uint8_t a[20]) {
  Payee *p = const_cast<Payee *>(payeeFind(a, false));
  if (!p) return false;
  p->active = true;
  save();
  return true;
}

bool payeeRemove(const uint8_t a[20]) {
  for (int i = 0; i < count; i++) {
    if (memcmp(list[i].address, a, 20) == 0) {
      list[i] = list[--count];
      save();
      return true;
    }
  }
  return false;
}
