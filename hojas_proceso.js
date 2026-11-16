/* ───────────────────────── Solapa "Hojas de proceso" ─────────────────────────
   Lee/borra fichas de usuarios/{UID}/hojas (y su subcolección "adjuntos" al borrar).
   No toca el documento usuarios/{UID} ni scheduleSync(): usa el mismo _userId/db
   de gestion_produccion.js pero una colección totalmente aparte. */

let _hojasCache = [];

function _escHoja(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function _hojaTsMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

function _fmtFechaHoja(ts) {
  const ms = _hojaTsMillis(ts);
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

async function renderHojas() {
  const tbody = document.getElementById('hojas-tabla-body');
  if (!tbody) return; // la solapa todavía no se mostró / no existe en este momento
  if (!_userId) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px">Iniciá sesión para ver las hojas de proceso.</td></tr>';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px">Cargando…</td></tr>';
  try {
    const snap = await db.collection('usuarios').doc(_userId).collection('hojas').get();
    _hojasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHojasTabla();
  } catch (err) {
    console.error('Error leyendo hojas de proceso:', err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#c0392b;padding:20px">
      No se pudieron cargar las hojas de proceso: ${_escHoja(err.message || err)}
    </td></tr>`;
  }
}

/* Filtra/ordena/pinta lo que ya está en _hojasCache, sin volver a leer Firestore */
function renderHojasTabla() {
  const tbody = document.getElementById('hojas-tabla-body');
  if (!tbody) return;
  const filterText = (document.getElementById('hojas-filter-text')?.value || '').trim().toLowerCase();

  let lista = _hojasCache;
  if (filterText) {
    lista = lista.filter(h => `${h.codigo || ''} ${h.nombre || ''} ${h.cliente || ''}`.toLowerCase().includes(filterText));
  }
  lista = [...lista].sort((a, b) => _hojaTsMillis(b.actualizada) - _hojaTsMillis(a.actualizada));

  const countEl = document.getElementById('hojas-count');
  if (countEl) countEl.textContent = `${lista.length} de ${_hojasCache.length}`;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px">
      ${_hojasCache.length === 0 ? 'Todavía no hay hojas. Creá la primera con «Nueva hoja».' : 'Sin hojas con ese filtro.'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(h => {
    const nOt = (h.otNums || []).length;
    return `<tr>
      <td style="font-weight:700">${_escHoja(h.codigo || '—')}</td>
      <td>${_escHoja(h.nombre || '—')}</td>
      <td>${_escHoja(h.cliente || '—')}</td>
      <td style="font-size:11px;color:var(--gris-oscuro)">${_escHoja(h.resumen || '—')}</td>
      <td>${_fmtFechaHoja(h.actualizada)}</td>
      <td style="text-align:center">${nOt}</td>
      <td style="white-space:nowrap">
        <div style="display:flex;gap:4px">
          <button onclick="abrirHoja('${h.id}')" style="font-size:10px;padding:2px 8px;border:1px solid var(--negro);border-radius:4px;cursor:pointer;background:var(--negro);color:var(--blanco)">Abrir</button>
          <button onclick="eliminarHoja('${h.id}')" style="font-size:10px;padding:2px 8px;border:1px solid #c0392b;border-radius:4px;cursor:pointer;background:none;color:#c0392b">Eliminar</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function abrirHoja(id) {
  window.open('hoja_de_procesos.html?id=' + encodeURIComponent(id), '_blank');
}

/* Borra una subcolección completa en lotes (Firestore no permite borrar una colección de un
   solo saque). 400 por lote para quedar bien debajo del límite de 500 operaciones por batch. */
async function _borrarSubcoleccionEnLotes(colRef, tam = 400) {
  while (true) {
    const snap = await colRef.limit(tam).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < tam) return;
  }
}

async function eliminarHoja(id) {
  if (!_userId) return;
  const h = _hojasCache.find(x => x.id === id);
  if (!h) return;
  const nOt = (h.otNums || []).length;
  let msg = `Se borrará la hoja "${h.codigo || id}" y todos sus adjuntos. No se puede deshacer.`;
  if (nOt > 0) msg += `\n\n⚠ Esta hoja tiene ${nOt} OT asociada${nOt > 1 ? 's' : ''}. Se va a borrar igual, pero esas OT van a quedar sin su hoja de proceso vinculada.`;
  if (!confirm(msg)) return;
  try {
    const ref = db.collection('usuarios').doc(_userId).collection('hojas').doc(id);
    await _borrarSubcoleccionEnLotes(ref.collection('adjuntos'));
    await ref.delete();
    _hojasCache = _hojasCache.filter(x => x.id !== id);
    renderHojasTabla();
  } catch (err) {
    console.error('Error eliminando hoja de proceso:', err);
    alert('No se pudo eliminar la hoja: ' + (err.message || err));
  }
}

/* Si el usuario vuelve a esta pestaña del navegador y la solapa de Hojas está a la vista,
   se refresca sola (por si se guardó algo desde hoja_de_procesos.html en otra pestaña) */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const pane = document.getElementById('pane-hojas');
  if (pane && pane.classList.contains('active')) renderHojas();
});
