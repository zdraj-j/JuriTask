/**
 * JuriTask — calendar.js
 * Vista de calendario mensual con eventos de vencimientos y tareas.
 */

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

function _calEventDot(ev, dateStr) {
  const dot = document.createElement('div');
  const dc  = dateClass(dateStr);
  const cls = ev.tipo === 'venc' ? (dc || 'upcoming') : 'tarea';
  dot.className   = `cal-event-dot ${cls}${ev.urgente ? ' cal-urg' : ''}`;
  const showDesc = STATE.config.calendarShowDesc !== false;
  const showNum  = STATE.config.calendarShowNum  !== false;
  const label = showNum && showDesc ? ev.desc
              : showNum  ? `#${ev.t.numero}`
              : showDesc ? ev.desc.replace(/^#\d+\s*/, '')
              : (ev.tipo === 'venc' ? 'Venc.' : 'Tarea');
  dot.textContent = label.length > 28 ? label.slice(0, 27) + '…' : label;
  dot.title       = ev.desc;
  dot.addEventListener('click', e => { e.stopPropagation(); openDetail(ev.t.id); });
  return dot;
}

function renderCalendar() {
  const titleEl = document.getElementById('calMonthTitle');
  const grid    = document.getElementById('calGrid');
  if (!titleEl || !grid) return;

  titleEl.textContent = `${MESES[calMonth]} ${calYear}`;
  grid.innerHTML = '';

  const primerDia = new Date(calYear, calMonth, 1);
  const ultimoDia = new Date(calYear, calMonth + 1, 0);

  // ISO week: lunes = 0 … domingo = 6
  let startDow = primerDia.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const totalCells = startDow + ultimoDia.getDate();
  const rows       = Math.ceil(totalCells / 7);
  const hoy        = today();

  // ── Filtro de tipo de evento según config ──────────────────
  const calShow = STATE.config.calendarShow || 'both';

  // ── Construir mapa de eventos por fecha ──────────────────
  const eventMap = {}; // 'YYYY-MM-DD' → [{tipo, t, desc, urgente?}]

  STATE.tramites.filter(t => !t.terminado).forEach(t => {
    // Vencimiento
    if ((calShow === 'both' || calShow === 'venc') && t.fechaVencimiento && !t.gestion?.cumplimiento) {
      const k = t.fechaVencimiento;
      if (!eventMap[k]) eventMap[k] = [];
      eventMap[k].push({ tipo: 'venc', t, desc: `#${t.numero} ${t.descripcion}` });
    }
    // Tareas pendientes con fecha
    if (calShow === 'both' || calShow === 'tarea') {
      (t.seguimiento || [])
        .filter(s => s.estado === 'pendiente' && s.fecha)
        .forEach(s => {
          const k = s.fecha;
          if (!eventMap[k]) eventMap[k] = [];
          eventMap[k].push({ tipo: 'tarea', t, desc: `#${t.numero} ${s.descripcion}`, urgente: s.urgente });
        });
    }
  });

  // ── Render celdas ────────────────────────────────────────
  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');
    row.className = 'cal-row';

    for (let c = 0; c < 7; c++) {
      const cellIdx = r * 7 + c;
      const dayNum  = cellIdx - startDow + 1;
      const cell    = document.createElement('div');

      if (dayNum < 1 || dayNum > ultimoDia.getDate()) {
        cell.className = 'cal-cell cal-cell-empty';
        row.appendChild(cell);
        continue;
      }

      const mm      = String(calMonth + 1).padStart(2, '0');
      const dd      = String(dayNum).padStart(2, '0');
      const dateStr = `${calYear}-${mm}-${dd}`;
      const isHoy   = dateStr === hoy;

      cell.className = 'cal-cell' + (isHoy ? ' cal-today' : '');

      const dayLabel = document.createElement('div');
      dayLabel.className = 'cal-day-num' + (isHoy ? ' cal-day-today' : '');
      dayLabel.textContent = dayNum;
      cell.appendChild(dayLabel);

      const events  = eventMap[dateStr] || [];
      const maxShow = 3;

      events.slice(0, maxShow).forEach(ev => {
        cell.appendChild(_calEventDot(ev, dateStr));
      });

      if (events.length > maxShow) {
        const more = document.createElement('div');
        more.className   = 'cal-event-more';
        more.textContent = `+${events.length - maxShow} más`;
        more.style.cursor = 'pointer';
        let expanded = false;
        more.addEventListener('click', e => {
          e.stopPropagation();
          if (!expanded) {
            expanded = true;
            more.style.display = 'none';
            events.slice(maxShow).forEach(ev => {
              cell.appendChild(_calEventDot(ev, dateStr));
            });
          }
        });
        cell.appendChild(more);
      }

      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
}
