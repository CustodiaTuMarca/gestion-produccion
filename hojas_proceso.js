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

/* ─────────────────────── Vínculo OT ↔ Hoja de proceso ───────────────────────
   Todo esto "engancha" el modal de OT desde afuera (monkey-patch de las funciones
   globales openOT/saveOT/loadOTFields/clearOTFields/readOTFields que ya existen en
   gestion_produccion.js) para no tener que tocar ese archivo salvo lo mínimo
   (un solo hook en printOT, ver gestion_produccion.js). hProc ("H. PROC." / SI-NO)
   es un campo viejo de la OT sin relación con esto — no se toca. */

let _otHojaCodigoActual = '';     // código de la hoja vinculada, aunque la hoja ya no exista
let _otHojaSeleccionPendiente = ''; // hojaId a preseleccionar la próxima vez que se pinten las opciones

function onCambioHojaProcOT() {
  const si = document.getElementById('ot-hoja-si')?.checked;
  const wrap = document.getElementById('ot-hoja-selector-wrap');
  if (wrap) wrap.style.display = si ? 'block' : 'none';
  if (si) {
    const sug = document.getElementById('ot-hoja-sugerencia');
    if (sug) sug.style.display = 'none';
  } else {
    _mostrarSugerenciaHojaOT();
  }
}

/* Pinta el <select> de hojas según el texto de búsqueda, preservando la selección
   actual (o la pendiente de aplicar) aunque no coincida con el filtro escrito */
function renderOTHojaOpciones() {
  const selEl = document.getElementById('ot-hoja-sel');
  const sinHojasEl = document.getElementById('ot-hoja-sin-hojas');
  const noExisteEl = document.getElementById('ot-hoja-noexiste');
  if (!selEl) return;
  const filtro = (document.getElementById('ot-hoja-buscar')?.value || '').trim().toLowerCase();
  const actual = _otHojaSeleccionPendiente || selEl.value || '';

  if (!_hojasCache.length) {
    selEl.innerHTML = '<option value="">—</option>';
    selEl.style.display = 'none';
    if (sinHojasEl) sinHojasEl.style.display = 'block';
    if (noExisteEl) noExisteEl.style.display = actual ? 'block' : 'none';
    _actualizarAccionesHojaOT();
    _otHojaSeleccionPendiente = '';
    return;
  }
  selEl.style.display = 'block';
  if (sinHojasEl) sinHojasEl.style.display = 'none';

  let lista = _hojasCache.filter(h => `${h.codigo || ''} ${h.nombre || ''}`.toLowerCase().includes(filtro));
  const existeActual = _hojasCache.some(h => h.id === actual);
  if (actual && existeActual && !lista.some(h => h.id === actual)) {
    lista = [_hojasCache.find(h => h.id === actual), ...lista];
  }

  const opciones = ['<option value="">— Elegir hoja —</option>'].concat(
    lista.map(h => `<option value="${h.id}" ${h.id === actual ? 'selected' : ''}>${_escHoja(h.codigo || '?')} — ${_escHoja(h.nombre || 'sin nombre')}</option>`)
  );
  selEl.innerHTML = opciones.join('');
  if (noExisteEl) noExisteEl.style.display = (actual && !existeActual) ? 'block' : 'none';
  _actualizarAccionesHojaOT();
  _otHojaSeleccionPendiente = '';
}

function _actualizarAccionesHojaOT() {
  const selEl = document.getElementById('ot-hoja-sel');
  const acciones = document.getElementById('ot-hoja-acciones');
  if (!acciones) return;
  acciones.style.display = (selEl && selEl.value) ? 'flex' : 'none';
}

function onSeleccionarHojaOT() {
  _actualizarAccionesHojaOT();
  const sug = document.getElementById('ot-hoja-sugerencia');
  if (sug) sug.style.display = 'none';
}

function verHojaOT() {
  const selEl = document.getElementById('ot-hoja-sel');
  const id = selEl && selEl.value;
  if (!id) return;
  window.open('hoja_de_procesos.html?id=' + encodeURIComponent(id), '_blank');
}

/* Si el código/pieza de la OT coincide exacto con el código de UNA sola hoja y todavía
   no hay ninguna elegida, lo sugiere — pero no la selecciona sola */
function _mostrarSugerenciaHojaOT() {
  const el = document.getElementById('ot-hoja-sugerencia');
  if (!el) return;
  const selEl = document.getElementById('ot-hoja-sel');
  if (selEl && selEl.value) { el.style.display = 'none'; return; }
  const pieza = (document.getElementById('ot-pieza')?.value || '').trim().toLowerCase();
  if (!pieza) { el.style.display = 'none'; return; }
  const coincidencias = _hojasCache.filter(h => (h.codigo || '').trim().toLowerCase() === pieza);
  if (coincidencias.length !== 1) { el.style.display = 'none'; return; }
  const h = coincidencias[0];
  el.innerHTML = `Sugerida: <b>${_escHoja(h.codigo)} — ${_escHoja(h.nombre || 'sin nombre')}</b> · <a href="#" onclick="usarHojaSugeridaOT('${h.id}');return false">¿usar?</a>`;
  el.style.display = 'block';
}

function usarHojaSugeridaOT(hojaId) {
  const siEl = document.getElementById('ot-hoja-si');
  if (siEl) siEl.checked = true;
  onCambioHojaProcOT();
  _otHojaSeleccionPendiente = hojaId;
  renderOTHojaOpciones();
  onSeleccionarHojaOT();
}

/* Refresca la caché de hojas y repinta el selector — se llama cada vez que se abre el modal de OT */
async function _prepararSelectorHojaOT() {
  const imprimirChk = document.getElementById('ot-hoja-imprimir');
  if (imprimirChk) imprimirChk.checked = true; // se decide cada vez, no se guarda en la OT
  const buscarEl = document.getElementById('ot-hoja-buscar');
  if (buscarEl) buscarEl.value = '';
  await renderHojas();
  renderOTHojaOpciones();
  _mostrarSugerenciaHojaOT();
}

/* ── Monkey-patch de las funciones del modal de OT (definidas en gestion_produccion.js) ── */

const _openOTOriginal = window.openOT;
window.openOT = function (compId, runId) {
  _openOTOriginal(compId, runId);
  _prepararSelectorHojaOT();
};

const _loadOTFieldsOriginal = window.loadOTFields;
window.loadOTFields = function (ot) {
  _loadOTFieldsOriginal(ot);
  const siEl = document.getElementById('ot-hoja-si');
  const noEl = document.getElementById('ot-hoja-no');
  if (siEl) siEl.checked = ot.hojaProc === 'si';
  if (noEl) noEl.checked = ot.hojaProc === 'no';
  _otHojaCodigoActual = ot.hojaCodigo || '';
  _otHojaSeleccionPendiente = ot.hojaId || '';
  onCambioHojaProcOT();
  renderOTHojaOpciones();
  _mostrarSugerenciaHojaOT();
};

const _clearOTFieldsOriginal = window.clearOTFields;
window.clearOTFields = function () {
  _clearOTFieldsOriginal();
  const siEl = document.getElementById('ot-hoja-si');
  const noEl = document.getElementById('ot-hoja-no');
  if (siEl) siEl.checked = false;
  if (noEl) noEl.checked = false;
  _otHojaCodigoActual = '';
  _otHojaSeleccionPendiente = '';
  onCambioHojaProcOT();
  renderOTHojaOpciones();
  _mostrarSugerenciaHojaOT();
};

const _readOTFieldsOriginal = window.readOTFields;
window.readOTFields = function () {
  const fields = _readOTFieldsOriginal();
  const si = document.getElementById('ot-hoja-si')?.checked;
  const no = document.getElementById('ot-hoja-no')?.checked;
  fields.hojaProc = si ? 'si' : (no ? 'no' : '');
  const selEl = document.getElementById('ot-hoja-sel');
  if (fields.hojaProc === 'si' && selEl && selEl.value) {
    fields.hojaId = selEl.value;
    const hoja = _hojasCache.find(h => h.id === selEl.value);
    fields.hojaCodigo = hoja ? (hoja.codigo || '') : _otHojaCodigoActual;
  } else {
    fields.hojaId = '';
    fields.hojaCodigo = '';
  }
  return fields;
};

/* Suma/resta el N° de OT en otNums de la hoja correspondiente. No usa set/merge del
   documento completo ni toca "actualizada" (solo ese campo), y nunca bloquea ni hace
   fallar el guardado de la OT: los errores quedan en un aviso discreto (showToast). */
async function _sincronizarVinculoHoja(hojaIdAnterior, hojaIdNuevo, otNum) {
  if (!_userId || hojaIdAnterior === hojaIdNuevo) return;
  const hojasRef = db.collection('usuarios').doc(_userId).collection('hojas');
  let huboError = false;
  if (hojaIdAnterior) {
    try { await hojasRef.doc(hojaIdAnterior).update({ otNums: firebase.firestore.FieldValue.arrayRemove(otNum) }); }
    catch (err) { console.error('No se pudo desvincular la OT de la hoja anterior:', err); huboError = true; }
  }
  if (hojaIdNuevo) {
    try { await hojasRef.doc(hojaIdNuevo).update({ otNums: firebase.firestore.FieldValue.arrayUnion(otNum) }); }
    catch (err) { console.error('No se pudo vincular la OT a la hoja:', err); huboError = true; }
  }
  if (huboError && typeof showToast === 'function') {
    showToast('La OT se guardó, pero no se pudo actualizar el vínculo con la hoja de proceso.');
  }
}

const _saveOTOriginal = window.saveOT;
window.saveOT = function () {
  let hojaIdAnterior = null;
  if (_otEditNum) {
    const found = _findOTByKey(_otEditNum);
    if (found) hojaIdAnterior = found.ot.hojaId || null;
  }
  const resultado = _saveOTOriginal();
  if (resultado !== false) {
    // _otEditNum ya quedó seteado (nueva OT recién creada o la existente) por el saveOT original
    const found = _otEditNum ? _findOTByKey(_otEditNum) : null;
    if (found) {
      const hojaIdNuevo = found.ot.hojaId || null;
      _sincronizarVinculoHoja(hojaIdAnterior, hojaIdNuevo, found.ot.otNum);
    }
  }
  return resultado;
};

/* Tras imprimir la OT (hook llamado al final de printOT() en gestion_produccion.js, solo
   si la OT se imprimió de verdad): si la casilla está tildada y hay hoja elegida, abre
   también la hoja de proceso para imprimir. Si no hay checkbox/hoja (OT vieja o sin hoja),
   no hace nada y la OT se imprime exactamente igual que antes. */
function _despuesDeImprimirOT() {
  const chk = document.getElementById('ot-hoja-imprimir');
  const selEl = document.getElementById('ot-hoja-sel');
  const hojaId = selEl && selEl.value;
  if (!chk || !chk.checked || !hojaId) return;
  const popup = window.open('hoja_de_procesos.html?id=' + encodeURIComponent(hojaId) + '&imprimir=1', '_blank');
  if (!popup || popup.closed || typeof popup.closed === 'undefined') {
    _avisoPopupHojaBloqueado(hojaId);
  }
}

function _avisoPopupHojaBloqueado(hojaId) {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);'
    + 'background:var(--negro);color:var(--amarillo);font-size:12px;font-weight:600;'
    + 'padding:10px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);'
    + 'z-index:99999;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
  div.innerHTML = `<span>El navegador bloqueó la ventana de la hoja de proceso.</span>
    <a href="hoja_de_procesos.html?id=${encodeURIComponent(hojaId)}&imprimir=1" target="_blank" rel="noopener" style="color:var(--amarillo);text-decoration:underline">Abrirla a mano</a>
    <button type="button" style="background:none;border:none;color:var(--amarillo);cursor:pointer;font-size:14px;line-height:1" onclick="this.parentElement.remove()">✕</button>`;
  document.body.appendChild(div);
}
