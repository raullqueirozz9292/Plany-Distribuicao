// Modelos conceituais com dados fictícios. Não importam dados dos aplicativos.
export const SAMPLE_COST = Object.freeze({ materials: 6000, labor: 3000, overhead: 700, freight: 300 });
export function priceExample(discount = 5, protect = false) {
  if (!Number.isFinite(discount) || discount < 0 || discount > 50) throw new RangeError('Desconto fora do exemplo');
  const cost = Object.values(SAMPLE_COST).reduce((a, b) => a + b, 0);
  const plannedProfitPercent = 60; // Lucro configurado sobre o custo; não é margem sobre a venda.
  const target = cost * (1 + plannedProfitPercent / 100);
  const before = protect ? target / (1 - discount / 100) : target;
  const sale = before * (1 - discount / 100);
  return { cost, before, discount, sale, profit: sale - cost, margin: (sale - cost) / sale * 100, plannedProfitPercent, protect };
}
const DAY = 86400000;
const date = value => new Date(value + 'T12:00:00Z');
const iso = value => value.toISOString().slice(0, 10);
export function scheduleExample(cutDays = 3, saturday = false, holiday = true) {
  if (!Number.isInteger(cutDays) || cutDays < 1 || cutDays > 6) throw new RangeError('Duração fora do exemplo');
  const blocked = holiday ? ['2026-11-11'] : [];
  const isWork = d => d.getUTCDay() !== 0 && (saturday || d.getUTCDay() !== 6) && !blocked.includes(iso(d));
  let cursor = date('2026-11-09');
  return [['Projeto', 2], ['Corte', cutDays], ['Montagem', 2], ['Instalação', 1]].map(([name, duration]) => {
    const days = [];
    while (days.length < duration) {
      if (isWork(cursor)) days.push(iso(cursor));
      cursor = new Date(cursor.getTime() + DAY);
    }
    return { name, duration, days, start: days[0], end: days.at(-1) };
  });
}
export const dayOffset = value => Math.round((date(value) - date('2026-11-09')) / DAY);
