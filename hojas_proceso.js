/* ───────────────────────── Solapa "Hojas de proceso" ─────────────────────────
   Lee/borra fichas de usuarios/{UID}/hojas (y su subcolección "adjuntos" al borrar).
   No toca el documento usuarios/{UID} ni scheduleSync(): usa el mismo _userId/db
   de gestion_produccion.js pero una colección totalmente aparte. */

let _hojasCache = [];
let _hojasCacheEstado = 'idle'; // 'idle' | 'cargando' | 'ok' | 'error'
let _hojasCacheError = '';
let _hojasCacheTs = 0;
const HOJAS_CACHE_TTL_MS = 60000;

function _escHoja(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* minúsculas y sin acentos, para que el buscador no distinga mayúsculas ni tildes */
/* Rango Unicode de marcas diacríticas combinantes (0x0300-0x036F), construido por código
   de carácter para no depender de tipear acentos "sueltos" literales en el archivo fuente */
const _RE_DIACRITICOS = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
function _normalizarTexto(s) {
  const sinAcentos = String(s ?? '').toLowerCase().normalize('NFD').replace(_RE_DIACRITICOS, '');
  return sinAcentos.trim();
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
  if (!_userId) {
    _hojasCacheEstado = 'idle';
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px">Iniciá sesión para ver las hojas de proceso.</td></tr>';
    return;
  }
  _hojasCacheEstado = 'cargando';
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px">Cargando…</td></tr>';
  try {
    const snap = await db.collection('usuarios').doc(_userId).collection('hojas').get();
    _hojasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _hojasCacheEstado = 'ok';
    _hojasCacheTs = Date.now();
    _hojasCacheError = '';
    renderHojasTabla();
  } catch (err) {
    console.error('Error leyendo hojas de proceso:', err);
    _hojasCacheEstado = 'error';
    _hojasCacheError = err.message || String(err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#c0392b;padding:20px">
      No se pudieron cargar las hojas de proceso: ${_escHoja(_hojasCacheError)}
    </td></tr>`;
  }
}

/* Reusa la caché si está fresca (< 60s) y sin errores; si no, vuelve a leer Firestore.
   Se llama al abrir el modal de OT para no mostrar "No hay hojas" cuando en realidad
   todavía no se leyó nada (o la última lectura falló) */
async function _asegurarHojasCache() {
  const fresca = _hojasCacheEstado === 'ok' && (Date.now() - _hojasCacheTs) < HOJAS_CACHE_TTL_MS;
  if (fresca) return;
  await renderHojas();
}

/* Filtra/ordena/pinta lo que ya está en _hojasCache, sin volver a leer Firestore */
function renderHojasTabla() {
  const tbody = document.getElementById('hojas-tabla-body');
  if (!tbody) return;
  const filterText = _normalizarTexto(document.getElementById('hojas-filter-text')?.value || '');

  let lista = _hojasCache;
  if (filterText) {
    lista = lista.filter(h => _normalizarTexto(`${h.codigo || ''} ${h.nombre || ''} ${h.cliente || ''}`).includes(filterText));
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
      <td style="text-align:center">${nOt > 0
        ? `<a href="#" onclick="verOtAsociadas('${h.id}');return false" style="color:#2980b9;font-weight:700;text-decoration:underline;cursor:pointer">${nOt}</a>`
        : `<span style="color:#ccc">${nOt}</span>`}</td>
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
   (un hook en printOT y un onchange en el <select id="ot-hproc">, ver
   gestion_produccion.js / gestion_produccion_v2.html).

   El bloque usa el campo YA EXISTENTE "H. PROC." (ot.hProc, el desplegable SI/NO/—
   que se imprime en la fila PIEZA/PLANO·DESCRIPCIÓN·H.PROC.·UNID·OPs) como única
   pregunta — no hay un Sí/No nuevo. Se muestra cuando hProc==='SI' O la OT ya tenía
   una hoja vinculada (hojaId), para no ocultar un vínculo viejo solo porque hProc
   haya quedado en blanco. */

let _otHojaCodigoActual = '';       // código de la hoja vinculada, aunque la hoja ya no exista
let _otHojaSeleccionPendiente = ''; // hojaId a preseleccionar la próxima vez que se pinten las opciones
let _otTieneHojaIdActual = false;   // la OT que está abierta ya tenía hojaId al cargarla

/* Muestra/oculta el contenido (buscador+selector+acciones) según H. PROC. o si ya
   había una hoja vinculada; NO limpia nada (se usa también al cargar datos) */
function _actualizarVisibilidadHojaWrap() {
  const hprocEl = document.getElementById('ot-hproc');
  const esSi = hprocEl && hprocEl.value === 'SI';
  const mostrarContenido = !!(esSi || _otTieneHojaIdActual);
  const contenidoEl = document.getElementById('ot-hoja-contenido');
  if (contenidoEl) contenidoEl.style.display = mostrarContenido ? 'block' : 'none';
  _actualizarVisibilidadWrapExterno();
  return mostrarContenido;
}

function _actualizarVisibilidadWrapExterno() {
  const wrap = document.getElementById('ot-hoja-wrap');
  if (!wrap) return;
  const contenidoVisible = document.getElementById('ot-hoja-contenido')?.style.display === 'block';
  const sugerenciaVisible = document.getElementById('ot-hoja-sugerencia')?.style.display === 'block';
  wrap.style.display = (contenidoVisible || sugerenciaVisible) ? 'block' : 'none';
}

/* onchange del <select id="ot-hproc"> — pasar a NO/— desvincula la hoja de ESTA
   edición (se limpia el selector; el arrayRemove real pasa recién al guardar) */
function onCambioHojaProcOT() {
  const hprocEl = document.getElementById('ot-hproc');
  if (hprocEl && hprocEl.value !== 'SI') {
    const selEl = document.getElementById('ot-hoja-sel');
    if (selEl) selEl.value = '';
    _otTieneHojaIdActual = false;
    _otHojaCodigoActual = '';
  }
  const mostrar = _actualizarVisibilidadHojaWrap();
  if (mostrar) renderOTHojaOpciones();
  _mostrarSugerenciaHojaOT();
}

/* Pinta el <select> de hojas según el texto de búsqueda (acentos/mayúsculas no importan),
   preservando la selección actual (o la pendiente de aplicar) aunque no coincida con el
   filtro escrito. Distingue "cargando"/"error" de "sin hojas" y de "sin resultados" del
   filtro, para no decir "no hay hojas" cuando en realidad todavía no se leyó nada. */
function renderOTHojaOpciones() {
  const selEl = document.getElementById('ot-hoja-sel');
  const sinHojasEl = document.getElementById('ot-hoja-sin-hojas');
  const noExisteEl = document.getElementById('ot-hoja-noexiste');
  const cargandoEl = document.getElementById('ot-hoja-cargando');
  const errorEl = document.getElementById('ot-hoja-error');
  if (!selEl) return;
  [sinHojasEl, noExisteEl, cargandoEl, errorEl].forEach(el => { if (el) el.style.display = 'none'; });

  if (_hojasCacheEstado === 'cargando') {
    selEl.style.display = 'none';
    if (cargandoEl) cargandoEl.style.display = 'block';
    _actualizarAccionesHojaOT();
    return;
  }
  if (_hojasCacheEstado === 'error') {
    selEl.style.display = 'none';
    if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = '⚠ No se pudieron cargar las hojas: ' + _hojasCacheError; }
    _actualizarAccionesHojaOT();
    return;
  }

  const filtro = _normalizarTexto(document.getElementById('ot-hoja-buscar')?.value || '');
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
  let lista = _hojasCache.filter(h => _normalizarTexto(`${h.codigo || ''} ${h.nombre || ''} ${h.cliente || ''}`).includes(filtro));
  const existeActual = _hojasCache.some(h => h.id === actual);
  if (actual && existeActual && !lista.some(h => h.id === actual)) {
    lista = [_hojasCache.find(h => h.id === actual), ...lista];
  }

  if (!lista.length) {
    selEl.innerHTML = '<option value="">Sin resultados</option>';
  } else {
    const opciones = ['<option value="">— Elegir hoja —</option>'].concat(
      lista.map(h => `<option value="${h.id}" ${h.id === actual ? 'selected' : ''}>${_escHoja(h.codigo || '?')} — ${_escHoja(h.nombre || 'sin nombre')}</option>`)
    );
    selEl.innerHTML = opciones.join('');
  }
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
  if (sug) { sug.style.display = 'none'; _actualizarVisibilidadWrapExterno(); }
}

function verHojaOT() {
  const selEl = document.getElementById('ot-hoja-sel');
  const id = selEl && selEl.value;
  if (!id) return;
  window.open('hoja_de_procesos.html?id=' + encodeURIComponent(id), '_blank');
}

/* Si el código/pieza de la OT coincide exacto con el código de UNA sola hoja y todavía
   no hay ninguna elegida, lo sugiere (visible aunque H.PROC. no esté en SI todavía) —
   pero no la selecciona sola */
function _mostrarSugerenciaHojaOT() {
  const el = document.getElementById('ot-hoja-sugerencia');
  if (!el) return;
  const ocultar = () => { el.style.display = 'none'; _actualizarVisibilidadWrapExterno(); };
  const selEl = document.getElementById('ot-hoja-sel');
  if (selEl && selEl.value) return ocultar();
  if (_hojasCacheEstado !== 'ok') return ocultar();
  const pieza = _normalizarTexto(document.getElementById('ot-pieza')?.value || '');
  if (!pieza) return ocultar();
  const coincidencias = _hojasCache.filter(h => _normalizarTexto(h.codigo || '') === pieza);
  if (coincidencias.length !== 1) return ocultar();
  const h = coincidencias[0];
  el.innerHTML = `Sugerida: <b>${_escHoja(h.codigo)} — ${_escHoja(h.nombre || 'sin nombre')}</b> · <a href="#" onclick="usarHojaSugeridaOT('${h.id}');return false">¿usar?</a>`;
  el.style.display = 'block';
  _actualizarVisibilidadWrapExterno();
}

function usarHojaSugeridaOT(hojaId) {
  const hprocEl = document.getElementById('ot-hproc');
  if (hprocEl) hprocEl.value = 'SI';
  _otHojaSeleccionPendiente = hojaId;
  _actualizarVisibilidadHojaWrap();
  renderOTHojaOpciones();
  onSeleccionarHojaOT();
}

/* Asegura una caché fresca de hojas y repinta el selector — se llama cada vez que se
   abre el modal de OT. Primero muestra "Cargando hojas…" si corresponde (no "No hay
   hojas", que es un estado distinto) y recién después de tener datos reales decide. */
async function _prepararSelectorHojaOT() {
  const imprimirChk = document.getElementById('ot-hoja-imprimir');
  if (imprimirChk) imprimirChk.checked = true; // se decide cada vez, no se guarda en la OT
  const buscarEl = document.getElementById('ot-hoja-buscar');
  if (buscarEl) buscarEl.value = '';
  if (_actualizarVisibilidadHojaWrap()) renderOTHojaOpciones();
  _mostrarSugerenciaHojaOT();
  await _asegurarHojasCache();
  if (_actualizarVisibilidadHojaWrap()) renderOTHojaOpciones();
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
  _otHojaCodigoActual = ot.hojaCodigo || '';
  _otHojaSeleccionPendiente = ot.hojaId || '';
  _otTieneHojaIdActual = !!ot.hojaId;
  if (_actualizarVisibilidadHojaWrap()) renderOTHojaOpciones();
  _mostrarSugerenciaHojaOT();
};

const _clearOTFieldsOriginal = window.clearOTFields;
window.clearOTFields = function () {
  _clearOTFieldsOriginal();
  _otHojaCodigoActual = '';
  _otHojaSeleccionPendiente = '';
  _otTieneHojaIdActual = false;
  if (_actualizarVisibilidadHojaWrap()) renderOTHojaOpciones();
  _mostrarSugerenciaHojaOT();
};

const _readOTFieldsOriginal = window.readOTFields;
window.readOTFields = function () {
  const fields = _readOTFieldsOriginal();
  const contenidoEl = document.getElementById('ot-hoja-contenido');
  const bloqueVisible = !!(contenidoEl && contenidoEl.style.display === 'block');
  const selEl = document.getElementById('ot-hoja-sel');
  if (bloqueVisible && selEl && selEl.value) {
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

/* ───────────────── Modal "OT asociadas a <hoja>" (solo lectura) ─────────────────
   Se abre únicamente desde la columna de OT de la solapa «Hojas de proceso»
   (NO desde el botón «Ver hoja» del modal de OT). Busca las OT en memoria, en
   projects[] (ya cargado por gestion_produccion.js) — sin leer nada de Firestore. */

/* El otNum es único entre todos los proyectos (la propia app lo valida al crear
   una OT manualmente), pero los IDS internos de componente/run sí se repiten entre
   proyectos — por eso se recorren TODOS los proyectos buscando por otNum, sin
   asumir a qué proyecto pertenece */
function _buscarOTPorNumero(otNum) {
  for (const p of (projects || [])) {
    const ot = (p.ordenes || []).find(o => o.otNum === otNum);
    if (ot) return { ot, proj: p };
  }
  return null;
}

/* Trata '', '—', 0 y valores no numéricos como "sin dato" */
function _numOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function _asegurarModalOtAsociadas() {
  let modal = document.getElementById('modal-ot-asociadas');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'modal-ot-asociadas';
  modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:20px;width:780px;max-width:95vw;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.2)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px">
        <div id="modal-ot-asociadas-title" style="font-weight:700;font-size:15px"></div>
        <button onclick="cerrarModalOtAsociadas()" style="background:none;border:none;font-size:18px;cursor:pointer;color:#888;line-height:1;flex-shrink:0">✕</button>
      </div>
      <div style="overflow-x:auto">
        <table class="tbl" id="modal-ot-asociadas-tabla">
          <thead><tr>
            <th>N° OT</th><th>Proyecto</th><th>Cliente</th><th>Fecha pedido</th>
            <th>Unid.</th><th>Estado</th><th>T. Producción</th><th>T. Total</th><th>T./Unidad</th>
          </tr></thead>
          <tbody id="modal-ot-asociadas-tabla-body"></tbody>
        </table>
      </div>
      <div id="modal-ot-asociadas-resumen" style="margin-top:10px;font-size:11px;color:var(--gris-oscuro)"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('mousedown', e => { if (e.target === modal) cerrarModalOtAsociadas(); });
  return modal;
}

function cerrarModalOtAsociadas() {
  const modal = document.getElementById('modal-ot-asociadas');
  if (modal) modal.style.display = 'none';
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const modal = document.getElementById('modal-ot-asociadas');
  if (modal && modal.style.display !== 'none') cerrarModalOtAsociadas();
});

function verOtAsociadas(hojaId) {
  const h = _hojasCache.find(x => x.id === hojaId);
  if (!h) return;
  const modal = _asegurarModalOtAsociadas();
  document.getElementById('modal-ot-asociadas-title').textContent =
    `OT asociadas a ${h.codigo || '—'} — ${h.nombre || 'sin nombre'}`;

  const otNums = [...new Set(h.otNums || [])].sort((a, b) => b - a);
  const colorEstado = { Anulada: '#c0392b', Completada: '#1a7a4a', Abierta: '#2980b9' };

  const filas = otNums.map(n => {
    const found = _buscarOTPorNumero(n);
    if (!found) return { otNum: n, noEncontrada: true };
    const { ot, proj } = found;
    const tProduc = _numOrNull(ot.tProduc);
    const tTotal = _numOrNull(ot.tTotal);
    const unidadesNum = _numOrNull(ot.unidades);
    const tPorUnidad = (tTotal != null && unidadesNum != null) ? tTotal / unidadesNum : null;
    return {
      otNum: n,
      proyecto: proj.name || '—',
      cliente: ot.cliente || '—',
      fecha: ot.fechaPedido,
      unidades: ot.unidades || '—',
      estado: ot.anulada ? 'Anulada' : (ot.completada ? 'Completada' : 'Abierta'),
      completada: !!ot.completada && !ot.anulada,
      tProduc, tTotal, tPorUnidad,
    };
  });

  const tbody = document.getElementById('modal-ot-asociadas-tabla-body');
  if (!filas.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:16px">Sin OT asociadas.</td></tr>';
  } else {
    tbody.innerHTML = filas.map(f => f.noEncontrada
      ? `<tr><td style="font-weight:700">OT ${f.otNum}</td><td colspan="8" style="color:#aaa;font-style:italic">OT no encontrada</td></tr>`
      : `<tr>
          <td style="font-weight:700">OT ${f.otNum}</td>
          <td>${_escHoja(f.proyecto)}</td>
          <td>${_escHoja(f.cliente)}</td>
          <td>${fmtDate(f.fecha)}</td>
          <td style="text-align:center">${_escHoja(String(f.unidades))}</td>
          <td><span style="color:${colorEstado[f.estado]};font-weight:700">${f.estado}</span></td>
          <td style="text-align:center">${f.tProduc != null ? f.tProduc + ' min' : '—'}</td>
          <td style="text-align:center">${f.tTotal != null ? f.tTotal + ' min' : '—'}</td>
          <td style="text-align:center">${f.tPorUnidad != null ? f.tPorUnidad.toFixed(1) + ' min' : '—'}</td>
        </tr>`
    ).join('');
  }

  const completadasConDato = filas.filter(f => !f.noEncontrada && f.completada && f.tPorUnidad != null);
  const promedio = completadasConDato.length
    ? completadasConDato.reduce((s, f) => s + f.tPorUnidad, 0) / completadasConDato.length
    : null;
  document.getElementById('modal-ot-asociadas-resumen').textContent =
    `${filas.length} OT asociada${filas.length !== 1 ? 's' : ''}`
    + (promedio != null ? ` · Promedio de tiempo por unidad (OT completadas): ${promedio.toFixed(1)} min` : '');

  modal.style.display = 'flex';
}
