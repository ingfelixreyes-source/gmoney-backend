/**
 * Date and Colombian Holiday Utilities
 * Implements Ley Emiliani (Law 51 of 1983) for Colombia
 */

// Easter Sunday calculation using Meeus/Jones/Butcher algorithm
export function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function nextMonday(date) {
  const d = new Date(date);
  const dayOfWeek = d.getUTCDay();
  if (dayOfWeek === 1) return d; // already Monday
  const diff = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function addDaysUtc(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function getColombianHolidays(year) {
  const holidays = new Set();
  const format = (d) => d.toISOString().slice(0, 10);

  // Fixed holidays
  holidays.add(`${year}-01-01`); // Año Nuevo
  holidays.add(`${year}-05-01`); // Día del Trabajo
  holidays.add(`${year}-07-20`); // Grito de Independencia
  holidays.add(`${year}-08-07`); // Batalla de Boyacá
  holidays.add(`${year}-12-08`); // Inmaculada Concepción
  holidays.add(`${year}-12-25`); // Navidad

  // Emiliani fixed holidays (moved to following Monday)
  holidays.add(format(nextMonday(new Date(Date.UTC(year, 0, 6)))));   // Reyes Magos
  holidays.add(format(nextMonday(new Date(Date.UTC(year, 2, 19)))));  // San José
  holidays.add(format(nextMonday(new Date(Date.UTC(year, 5, 29)))));  // San Pedro y San Pablo
  holidays.add(format(nextMonday(new Date(Date.UTC(year, 7, 15)))));  // Asunción de la Virgen
  holidays.add(format(nextMonday(new Date(Date.UTC(year, 9, 12)))));  // Día de la Raza
  holidays.add(format(nextMonday(new Date(Date.UTC(year, 10, 1)))));  // Todos los Santos
  holidays.add(format(nextMonday(new Date(Date.UTC(year, 10, 11))))); // Independencia de Cartagena

  // Easter-based holidays
  const easter = getEasterSunday(year);
  holidays.add(format(addDaysUtc(easter, -3))); // Jueves Santo
  holidays.add(format(addDaysUtc(easter, -2))); // Viernes Santo
  holidays.add(format(nextMonday(addDaysUtc(easter, 40)))); // Ascensión de Jesús
  holidays.add(format(nextMonday(addDaysUtc(easter, 60)))); // Corpus Christi
  holidays.add(format(nextMonday(addDaysUtc(easter, 68)))); // Sagrado Corazón

  return holidays;
}

export function isHoliday(dateStr, holidaysSet) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const set = holidaysSet || getColombianHolidays(year);
  return set.has(dateStr);
}

export function isSunday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCDay() === 0;
}

export function getNextValidDate(dateStr, { excludeSundays = true, excludeHolidays = false } = {}) {
  let [y, m, d] = dateStr.split('-').map(Number);
  let date = new Date(Date.UTC(y, m - 1, d));
  const holidays = excludeHolidays ? getColombianHolidays(y) : null;

  while (true) {
    const iso = date.toISOString().slice(0, 10);
    const dayOfWeek = date.getUTCDay();
    const isSun = dayOfWeek === 0;
    const isHol = excludeHolidays && isHoliday(iso, holidays);

    if ((excludeSundays && isSun) || (excludeHolidays && isHol)) {
      date.setUTCDate(date.getUTCDate() + 1);
    } else {
      return date.toISOString().slice(0, 10);
    }
  }
}

export function addPaymentFrequency(dateStr, frequency, { excludeSundays = true, excludeHolidays = false } = {}) {
  let [y, m, d] = dateStr.split('-').map(Number);
  let date = new Date(Date.UTC(y, m - 1, d));

  switch (frequency) {
    case 'Diario':
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case 'Semanal':
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case 'Quincenal':
      date.setUTCDate(date.getUTCDate() + 15);
      break;
    case 'Mensual':
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    default:
      date.setUTCDate(date.getUTCDate() + 1);
  }

  const nextIso = date.toISOString().slice(0, 10);
  return getNextValidDate(nextIso, { excludeSundays, excludeHolidays });
}

export function getTodayStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDaysDifference(dateStr1, dateStr2) {
  const [y1, m1, d1] = dateStr1.split('-').map(Number);
  const [y2, m2, d2] = dateStr2.split('-').map(Number);
  const d1Utc = Date.UTC(y1, m1 - 1, d1);
  const d2Utc = Date.UTC(y2, m2 - 1, d2);
  const diffMs = d2Utc - d1Utc;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
