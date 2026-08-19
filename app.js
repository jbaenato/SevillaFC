// --- Configuración de Supabase ---
const SUPABASE_URL = "https://ramnvcuwyfhepspzzzpn.supabase.co";
const SUPABASE_KEY = "sb_publishable_6B6PMd8eB85OKIS1e74Qgg_YPmTaAdj";
const TABLE = "evaluaciones";

// --- Seguimiento de errores (Sentry) ---
// Deja SENTRY_DSN vacío para desactivarlo sin que falle nada; rellénalo con el DSN real
// de tu proyecto en sentry.io (Settings → Client Keys) para activarlo.
const SENTRY_DSN = "https://97816607d64d3c79d2d51876240b2b4b@o4511937683259392.ingest.de.sentry.io/4511937734246480";
if (SENTRY_DSN && window.Sentry){
  Sentry.init({ dsn: SENTRY_DSN, environment: "produccion" });
}

// Envía un error a Sentry (si está configurado) sin interrumpir el flujo de la app aunque
// falle el propio envío. "contexto" son datos extra para facilitar el diagnóstico.
function reportarError(error, contexto){
  try {
    if (SENTRY_DSN && window.Sentry){
      Sentry.captureException(error, { extra: contexto || {} });
    } else {
      console.error("[reportarError]", error, contexto || {});
    }
  } catch(e){ /* nunca debe romper la app por fallar el propio reporte de errores */ }
}
const BORRADOR_KEY = "porteros_borrador_v1";
const PENDIENTES_KEY = "porteros_pendientes_sync_v1";

// Orden fijo de categorías y su columna de media correspondiente (igual para cualquier modalidad)
const CATEGORY_ORDER = ["Ofensivo / técnico", "Defensivo / táctico", "Físico / condicional", "Psicológico"];
const CATEGORY_COL = {
  "Ofensivo / técnico": "media_ofensivo_tecnico",
  "Defensivo / táctico": "media_defensivo_tactico",
  "Físico / condicional": "media_fisico_condicional",
  "Psicológico": "media_psicologico"
};

let DATA = [];             // se construye dinámicamente según la modalidad elegida
let valores = {};          // clave: item.id (uuid) -> { nd, val }
let modalidadSeleccionada = null; // { id, nombre }
let porterosDisponibles = [];
let equiposDisponibles = [];
let tecnicosDisponibles = [];

// --- Autenticación (Supabase Auth) ---
// El cliente 'sb' se usa solo para login/logout/sesión. Las lecturas de datos
// siguen haciéndose con fetch() + sbHeaders(), añadiendo el token de sesión.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let sesionActual = null;
let appIniciada = false;
let perfilActual = null; // { nombre, rol } del técnico con sesión iniciada

async function cargarPerfilActual(){
  try {
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/perfiles?select=nombre,rol",
      { headers: sbHeaders() }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const filas = await res.json();
    perfilActual = filas[0] || null;
  } catch(e){
    perfilActual = null;
  }

  const nombreTecnico = (perfilActual && perfilActual.nombre) ? perfilActual.nombre : (sesionActual ? sesionActual.user.email : "");
  document.getElementById("evaluador").value = nombreTecnico;

  if (!perfilActual || !perfilActual.nombre){
    setStatus("No se ha encontrado tu perfil de técnico. Pide a un coordinador que lo configure.", "var(--danger)");
  }

  document.getElementById("btnAuditoria").style.display = esCoordinador() ? "inline-block" : "none";
  document.getElementById("btnEquipos").style.display = esCoordinador() ? "inline-block" : "none";
}

function esCoordinador(){
  return !!(perfilActual && perfilActual.rol === "coordinador");
}

const ACCION_ETIQUETA = {
  crear_evaluacion: "Evaluación creada",
  editar_portero: "Portero editado",
  editar_evaluacion: "Puntuaciones editadas",
  eliminar_evaluacion: "Evaluación eliminada",
  fusionar_equipos: "Equipos fusionados"
};

async function abrirAuditoria(){
  const modal = document.getElementById("modalAuditoria");
  const cont = document.getElementById("auditoriaContenido");
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  modal.style.display = "flex";

  try {
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/auditoria?select=*&order=creado_en.desc&limit=200",
      { headers: sbHeaders() }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const filas = await res.json();

    if (filas.length === 0){
      cont.innerHTML = '<div class="empty">Todavía no hay ningún movimiento registrado.</div>';
      return;
    }

    cont.innerHTML = filas.map(f => {
      const fecha = new Date(f.creado_en);
      const cuando = fecha.toLocaleDateString() + " " + fecha.toLocaleTimeString().slice(0,5);
      const etiqueta = ACCION_ETIQUETA[f.accion] || f.accion;
      let detalleTexto = "";
      if (f.accion === "crear_evaluacion" && f.detalle){
        detalleTexto = f.detalle.portero + " · " + f.detalle.equipo;
      } else if (f.accion === "eliminar_evaluacion" && f.detalle){
        detalleTexto = f.detalle.portero || "";
      } else if (f.accion === "editar_portero" && f.detalle){
        const a = f.detalle.antes || {}, d = f.detalle.despues || {};
        detalleTexto = (a.nombre || "") + " (" + (a.lateralidad || "N/D") + ") → " + (d.nombre || "") + " (" + (d.lateralidad || "N/D") + ")";
      } else if (f.accion === "editar_evaluacion" && f.detalle){
        detalleTexto = (f.detalle.num_items || 0) + " ítem(s) puntuado(s)";
      } else if (f.accion === "fusionar_equipos" && f.detalle){
        detalleTexto = (f.detalle.origenes || []).join(", ") + " → " + (f.detalle.destino || "");
      }
      return '<div class="resumen-item" style="align-items:flex-start;">' +
        '<span class="etiqueta">' + cuando + '<br><span style="color:var(--text-muted);font-size:11px;">' + (f.actor_nombre || "—") + '</span></span>' +
        '<span class="valor" style="text-align:right;">' + etiqueta + '<br><span style="font-weight:400;color:var(--text-muted);font-size:12px;">' + detalleTexto + '</span></span>' +
        '</div>';
    }).join("");
  } catch(e){
    cont.innerHTML = '<div class="empty" style="color:var(--danger);">No se pudo cargar la auditoría. Comprueba tu conexión.</div>';
    reportarError(e, { contexto: "abrirAuditoria" });
  }
}

document.getElementById("btnAuditoria").addEventListener("click", abrirAuditoria);
document.getElementById("cerrarAuditoria").addEventListener("click", () => {
  document.getElementById("modalAuditoria").style.display = "none";
});
document.getElementById("modalAuditoria").addEventListener("click", e => {
  if (e.target.id === "modalAuditoria") document.getElementById("modalAuditoria").style.display = "none";
});

// --- Gestión y fusión de equipos duplicados (solo coordinador) ---

let equiposParaFusion = [];

async function abrirGestionEquipos(){
  const modal = document.getElementById("modalEquipos");
  const cont = document.getElementById("equiposContenido");
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  modal.style.display = "flex";

  try {
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/equipos?select=id,nombre&order=nombre.asc",
      { headers: sbHeaders() }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    equiposParaFusion = await res.json();

    if (equiposParaFusion.length === 0){
      cont.innerHTML = '<div class="empty">Todavía no hay equipos registrados.</div>';
      return;
    }

    // Cuenta cuántas evaluaciones (de las cargadas) tiene cada equipo, solo como orientación
    const conteo = {};
    evaluacionesCargadas.forEach(ev => {
      if (ev.equipo_id) conteo[ev.equipo_id] = (conteo[ev.equipo_id] || 0) + 1;
    });

    cont.innerHTML = equiposParaFusion.map(eq =>
      '<label class="resumen-item" style="cursor:pointer;">' +
        '<span class="etiqueta"><input type="checkbox" class="chk-equipo" value="' + eq.id + '" style="margin-right:8px;">' + eq.nombre + '</span>' +
        '<span class="valor" style="font-weight:400;color:var(--text-muted);">' + (conteo[eq.id] || 0) + ' evaluación(es)</span>' +
      '</label>'
    ).join("") +
    '<div id="fusionEquiposAcciones" style="display:none;margin-top:14px;">' +
      '<div class="field-group">' +
        '<label for="equipoDestino">Fusionar en</label>' +
        '<select id="equipoDestino"></select>' +
      '</div>' +
      '<button class="btn-primary" id="btnConfirmarFusion" style="width:100%;">Fusionar equipos seleccionados</button>' +
    '</div>' +
    '<div id="fusionEquiposError" class="login-error"></div>';

    cont.querySelectorAll(".chk-equipo").forEach(chk => {
      chk.addEventListener("change", actualizarSeleccionFusion);
    });
  } catch(e){
    cont.innerHTML = '<div class="empty" style="color:var(--danger);">No se pudieron cargar los equipos. Comprueba tu conexión.</div>';
    reportarError(e, { contexto: "abrirGestionEquipos" });
  }
}

function actualizarSeleccionFusion(){
  const seleccionados = Array.from(document.querySelectorAll(".chk-equipo:checked")).map(chk => chk.value);
  const acciones = document.getElementById("fusionEquiposAcciones");
  if (seleccionados.length < 2){
    acciones.style.display = "none";
    return;
  }
  acciones.style.display = "block";
  const select = document.getElementById("equipoDestino");
  select.innerHTML = seleccionados.map(id => {
    const eq = equiposParaFusion.find(e => e.id === id);
    return '<option value="' + id + '">' + (eq ? eq.nombre : id) + '</option>';
  }).join("");

  document.getElementById("btnConfirmarFusion").onclick = () => confirmarFusionEquipos(seleccionados);
}

async function confirmarFusionEquipos(seleccionados){
  const destino = document.getElementById("equipoDestino").value;
  const origenes = seleccionados.filter(id => id !== destino);
  const errorEl = document.getElementById("fusionEquiposError");
  const nombreDestino = (equiposParaFusion.find(e => e.id === destino) || {}).nombre || destino;

  if (origenes.length === 0) return;
  if (!confirm('¿Fusionar ' + origenes.length + ' equipo(s) en "' + nombreDestino + '"? Esta acción no se puede deshacer.')) return;

  try {
    const token = await obtenerAccessToken();
    const res = await fetch(SUPABASE_URL + "/functions/v1/fusionar-equipos", {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ equipo_destino_id: destino, equipos_origen_ids: origenes })
    });
    if (!res.ok){
      let mensaje = "HTTP " + res.status;
      try { const cuerpo = await res.json(); if (cuerpo.error) mensaje = cuerpo.error; } catch(e){}
      throw new Error(mensaje);
    }

    setStatus('Equipos fusionados en "' + nombreDestino + '".', "var(--success)");
    document.getElementById("modalEquipos").style.display = "none";
    renderSavedList();
    cargarListaEquipos();
  } catch(e){
    errorEl.textContent = "No se pudo fusionar: " + e.message;
    reportarError(e, { contexto: "confirmarFusionEquipos" });
  }
}

document.getElementById("btnEquipos").addEventListener("click", abrirGestionEquipos);
document.getElementById("cerrarEquipos").addEventListener("click", () => {
  document.getElementById("modalEquipos").style.display = "none";
});
document.getElementById("modalEquipos").addEventListener("click", e => {
  if (e.target.id === "modalEquipos") document.getElementById("modalEquipos").style.display = "none";
});

async function obtenerAccessToken(){
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.access_token : null;
}

function mostrarLogin(){
  document.getElementById("loginScreen").style.display = "block";
  document.getElementById("appContainer").style.display = "none";
}

function mostrarApp(){
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("appContainer").style.display = "block";
  if (!appIniciada){
    appIniciada = true;
    iniciarApp();
  }
}

document.getElementById("btnLogin").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");
  errorEl.textContent = "";
  if (!email || !password){
    errorEl.textContent = "Introduce tu email y contraseña.";
    return;
  }
  const btn = document.getElementById("btnLogin");
  btn.disabled = true;
  btn.textContent = "Entrando…";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  btn.textContent = "Entrar";
  if (error){
    errorEl.textContent = "Email o contraseña incorrectos.";
  }
});

document.getElementById("loginPassword").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btnLogin").click();
});

document.getElementById("btnLogout").addEventListener("click", async () => {
  await sb.auth.signOut();
});

sb.auth.onAuthStateChange((_evento, session) => {
  sesionActual = session;
  if (session) mostrarApp(); else mostrarLogin();
});

sb.auth.getSession().then(({ data }) => {
  sesionActual = data.session;
  if (data.session) mostrarApp(); else mostrarLogin();
});

function fmt(v){ return v.toFixed(2).replace(".", ","); }

function categoryAverage(sec){
  const vals = sec.items.map(it => valores[it.id]).filter(v => v && !v.nd).map(v => v.val);
  if (vals.length === 0) return null;
  return vals.reduce((a,b) => a+b, 0) / vals.length;
}

function sbHeaders(extra){
  const token = sesionActual ? sesionActual.access_token : SUPABASE_KEY;
  return Object.assign({
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json"
  }, extra || {});
}

async function loadSaved(){
  try {
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/" + TABLE + "?select=*,porteros(nombre,lateralidad,anio_nacimiento),equipos(nombre),modalidades(nombre),tecnicos(nombre)&eliminado_en=is.null&order=created_at.desc",
      { headers: sbHeaders() }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch(e) {
    console.error(e);
    return null;
  }
}

// Nota: la creación/inserción de evaluaciones, respuestas, porteros, equipos y técnicos
// ya no se hace desde el navegador — se centraliza en la Edge Function "guardar-evaluacion"
// para que las políticas RLS puedan cerrar la escritura directa desde el cliente.

async function cargarListaPorteros(){
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/porteros?select=nombre&order=nombre.asc", { headers: sbHeaders() });
    if (!res.ok) return;
    const porteros = await res.json();
    porterosDisponibles = porteros.map(p => p.nombre);
  } catch(e) { /* silencioso: el autocompletado es un extra, no crítico */ }
}

async function cargarListaEquipos(){
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/equipos?select=nombre&order=nombre.asc", { headers: sbHeaders() });
    if (!res.ok) return;
    const equipos = await res.json();
    equiposDisponibles = equipos.map(e => e.nombre);
  } catch(e) { /* silencioso: el autocompletado es un extra, no crítico */ }
}

async function cargarListaTecnicos(){
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/tecnicos?select=nombre&order=nombre.asc", { headers: sbHeaders() });
    if (!res.ok) return;
    const tecnicos = await res.json();
    tecnicosDisponibles = tecnicos.map(t => t.nombre);
  } catch(e) { /* silencioso: el autocompletado es un extra, no crítico */ }
}

async function cargarModalidades(){
  const cont = document.getElementById("modalidadGroup");
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/modalidades?select=id,nombre&order=nombre.asc", { headers: sbHeaders() });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const modalidades = await res.json();
    if (modalidades.length === 0){
      cont.innerHTML = '<span class="empty" style="padding:0;">No hay modalidades configuradas todavía.</span>';
      return;
    }
    cont.innerHTML = modalidades.map(m =>
      '<label class="radio-option"><input type="radio" name="modalidad" value="' + m.id + '" data-nombre="' + m.nombre + '"> ' + m.nombre + '</label>'
    ).join("");
    cont.querySelectorAll('input[name="modalidad"]').forEach(r => {
      r.addEventListener("change", e => {
        seleccionarModalidad(e.target.value, e.target.dataset.nombre);
      });
    });
  } catch(e){
    cont.innerHTML = '<span class="empty" style="padding:0; color:var(--danger);">No se pudieron cargar las modalidades. Comprueba tu conexión.</span>';
    reportarError(e, { contexto: "cargarModalidades" });
  }
}

async function seleccionarModalidad(id, nombre){
  modalidadSeleccionada = { id: id, nombre: nombre };
  const resto = document.getElementById("restoFormulario");
  resto.style.display = "none";
  document.getElementById("form").innerHTML = '<div class="empty">Cargando ítems de ' + nombre + '…</div>';
  document.getElementById("form").style.display = "block";

  try {
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/items_evaluacion?select=id,categoria,nombre,orden&modalidad_id=eq." + encodeURIComponent(id) + "&order=orden.asc",
      { headers: sbHeaders() }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const items = await res.json();

    const porCategoria = {};
    items.forEach(it => {
      if (!porCategoria[it.categoria]) porCategoria[it.categoria] = [];
      porCategoria[it.categoria].push({ id: it.id, nombre: it.nombre });
    });

    DATA = CATEGORY_ORDER
      .filter(cat => porCategoria[cat])
      .map(cat => ({ cat: cat, col: CATEGORY_COL[cat], items: porCategoria[cat] }));

    valores = {};
    DATA.forEach(s => s.items.forEach(it => { valores[it.id] = { nd: true, val: 2.5 }; }));

    resto.style.display = "block";
    renderForm();
  } catch(e){
    document.getElementById("form").innerHTML = '<div class="empty" style="color:var(--danger);">No se pudo cargar el formulario de ' + nombre + '. Comprueba tu conexión.</div>';
    reportarError(e, { contexto: "seleccionarModalidad", modalidad: nombre });
  }
}

// Extrae el nombre del portero embebido en la respuesta de Supabase (select=*,porteros(nombre))
function nombrePorteroDe(ev){
  if (!ev.porteros) return "(portero eliminado)";
  return Array.isArray(ev.porteros) ? (ev.porteros[0] ? ev.porteros[0].nombre : "") : ev.porteros.nombre;
}

// Extrae el nombre del equipo embebido en la respuesta de Supabase (select=*,equipos(nombre))
function nombreEquipoDe(ev){
  if (!ev.equipos) return "";
  return Array.isArray(ev.equipos) ? (ev.equipos[0] ? ev.equipos[0].nombre : "") : ev.equipos.nombre;
}

function nombreTecnicoDe(ev){
  if (!ev.tecnicos) return "";
  return Array.isArray(ev.tecnicos) ? (ev.tecnicos[0] ? ev.tecnicos[0].nombre : "") : ev.tecnicos.nombre;
}

function porteroCampo(ev, campo){
  if (!ev.porteros) return "";
  const p = Array.isArray(ev.porteros) ? ev.porteros[0] : ev.porteros;
  return (p && p[campo] !== null && p[campo] !== undefined) ? p[campo] : "";
}

function renderForm(){
  const form = document.getElementById("form");

  // Recordar qué secciones estaban abiertas antes de reconstruir el HTML
  const openState = {};
  form.querySelectorAll("details.section").forEach(d => { openState[d.dataset.cat] = d.open; });

  let html = "";
  DATA.forEach((sec) => {
    const avg = categoryAverage(sec);
    const isOpen = openState.hasOwnProperty(sec.cat) ? openState[sec.cat] : false;
    html += '<details class="section" data-cat="' + sec.cat + '" ' + (isOpen ? 'open' : '') + '>';
    html += '<summary><span class="section-title">' + sec.cat + '</span><span class="section-avg ' + (avg === null ? 'nd' : 'set') + '">Media: ' + (avg === null ? 'N/D' : fmt(avg)) + '</span></summary>';
    html += '<div class="card">';
    sec.items.forEach((it) => {
      const v = valores[it.id];
      html += '<div class="item-row">';
      html += '<div class="item-top">';
      html += '<span class="item-name">' + it.nombre + '</span>';
      html += '<span class="item-val ' + (v.nd ? 'nd' : 'set') + '">' + (v.nd ? 'N/D' : fmt(v.val)) + '</span>';
      html += '</div>';
      html += '<div class="item-controls">';
      html += '<input type="range" min="0" max="5" step="0.5" value="' + v.val + '" data-item="' + it.id + '" class="slider" ' + (v.nd ? 'disabled' : '') + '>';
      html += '<button class="nd-btn ' + (v.nd ? 'active' : '') + '" data-nd="' + it.id + '">N/D</button>';
      html += '</div></div>';
    });
    html += '</div></details>';
  });
  form.innerHTML = html;

  document.querySelectorAll(".slider").forEach(s => {
    s.addEventListener("input", e => {
      valores[e.target.dataset.item].val = parseFloat(e.target.value);
      renderForm();
      guardarBorrador();
    });
  });

  document.querySelectorAll(".nd-btn").forEach(b => {
    b.addEventListener("click", e => {
      const id = e.target.dataset.nd;
      valores[id].nd = !valores[id].nd;
      renderForm();
      guardarBorrador();
    });
  });
}

let evaluacionesCargadas = [];

async function renderSavedList(){
  const el = document.getElementById("savedList");
  el.innerHTML = '<div class="empty">Cargando evaluaciones…</div>';
  const list = await loadSaved();
  if (list === null){
    evaluacionesCargadas = [];
    el.innerHTML = '<div class="empty">No se ha podido conectar con la base de datos. Comprueba tu conexión.</div>';
    return;
  }
  evaluacionesCargadas = list;
  pintarListaGuardadas(document.getElementById("buscarGuardadas").value);
}

function filaGuardada(ev){
  const fecha = ev.fecha_partido || (ev.created_at ? ev.created_at.slice(0,10) : "");
  const modalidadNombre = ev.modalidades ? (Array.isArray(ev.modalidades) ? (ev.modalidades[0] ? ev.modalidades[0].nombre : "") : ev.modalidades.nombre) : "";
  const detalle = [modalidadNombre, nombreEquipoDe(ev), fecha, nombreTecnicoDe(ev) ? ("téc. " + nombreTecnicoDe(ev)) : ""].filter(Boolean).join(" · ");
  return '<div class="saved-row" data-id="' + ev.id + '"><span>' + nombrePorteroDe(ev) + (detalle ? ' <span style="color:var(--text-muted)">(' + detalle + ')</span>' : '') + '</span><span class="saved-row-arrow">›</span></div>';
}

function pintarListaGuardadas(filtro){
  const el = document.getElementById("savedList");
  if (evaluacionesCargadas.length === 0){
    el.innerHTML = '<div class="empty">Todavía no hay evaluaciones guardadas.</div>';
    return;
  }
  const texto = (filtro || "").trim().toLowerCase();
  const evalFinalFiltro = document.getElementById("filtroEvalFinal").value;

  if (!texto && !evalFinalFiltro){
    el.innerHTML = '<div class="empty">Escribe un nombre de portero, equipo o técnico, o elige una evaluación, para buscar.</div>';
    return;
  }
  const filtradas = evaluacionesCargadas.filter(ev =>
    (!texto || nombrePorteroDe(ev).toLowerCase().includes(texto) ||
      nombreEquipoDe(ev).toLowerCase().includes(texto) ||
      nombreTecnicoDe(ev).toLowerCase().includes(texto)) &&
    (!evalFinalFiltro || ev.evaluacion_final === evalFinalFiltro)
  );

  if (filtradas.length === 0){
    el.innerHTML = '<div class="empty">Sin resultados para esa búsqueda.</div>';
    return;
  }
  el.innerHTML = filtradas.map(filaGuardada).join("");
}

document.getElementById("filtroEvalFinal").addEventListener("change", () => {
  pintarListaGuardadas(document.getElementById("buscarGuardadas").value);
});

document.getElementById("evalFinalGroup").addEventListener("change", () => {
  document.getElementById("evalFinalGroup").style.outline = "";
});

document.getElementById("buscarGuardadas").addEventListener("input", e => {
  pintarListaGuardadas(e.target.value);
});

// Trae las puntuaciones ítem a ítem de una evaluación concreta
async function cargarRespuestasEvaluacion(id){
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/respuestas_evaluacion?select=item_id,valor,items_evaluacion(nombre,categoria,orden)&evaluacion_id=eq." + encodeURIComponent(id),
    { headers: sbHeaders() }
  );
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}

let detalleItemsActuales = {}; // { categoria: [{id, nombre, orden, valor}] } de la evaluación abierta en el detalle

async function abrirDetalleEvaluacion(ev){
  const modal = document.getElementById("modalDetalle");
  const cont = document.getElementById("detalleContenido");
  document.getElementById("detalleTitulo").textContent = nombrePorteroDe(ev);

  const modalidadNombre = ev.modalidades ? (Array.isArray(ev.modalidades) ? (ev.modalidades[0] ? ev.modalidades[0].nombre : "") : ev.modalidades.nombre) : "";
  const fecha = ev.fecha_partido || (ev.created_at ? ev.created_at.slice(0,10) : "");
  const lateralidadActual = porteroCampo(ev, "lateralidad") || "N/D";

  const cabecera = [
    ["Portero", nombrePorteroDe(ev) || "—"],
    ["Lateralidad", lateralidadActual],
    ["Técnico", nombreTecnicoDe(ev) || "—"],
    ["Equipo", nombreEquipoDe(ev) || "—"],
    ["Modalidad", modalidadNombre || "—"],
    ["Fecha", fecha || "—"],
    ["Tipo de visionado", ev.tipo_visionado || "—"],
    ["Partido", ev.partido || "—"],
    ["Evaluación final", ev.evaluacion_final || "N/D"]
  ];
  if (ev.observaciones) cabecera.push(["Observaciones", ev.observaciones]);

  const cabeceraHtml = cabecera.map(([etq, val]) =>
    '<div class="resumen-item"><span class="etiqueta">' + etq + '</span><span class="valor">' + val + '</span></div>'
  ).join("");

  const accionesHtml =
    '<div class="detalle-acciones">' +
      '<button class="btn-secondary" id="btnEditarPortero" style="padding:6px 12px;font-size:12px;">Editar datos del portero</button>' +
      (esCoordinador() ? '<button class="btn-secondary" id="btnEditarItems" style="padding:6px 12px;font-size:12px;">Editar puntuaciones</button>' : '') +
      (esCoordinador() ? '<button class="btn-secondary" id="btnEliminarEvaluacion" style="padding:6px 12px;font-size:12px;color:var(--danger);">Eliminar evaluación</button>' : '') +
    '</div>';

  const historialHtml = construirHistorialEquipos(ev);

  cont.innerHTML = accionesHtml + '<div id="editarPorteroForm"></div><div id="editarItemsForm"></div>' + cabeceraHtml + historialHtml + '<div id="detalleItemsContenido"><div class="empty" style="padding-top:14px;">Cargando ítems…</div></div>';
  modal.style.display = "flex";
  enlazarAccionesDetalle(ev);

  try {
    await cargarYPintarItemsDetalle(ev);
  } catch(e){
    document.getElementById("detalleItemsContenido").innerHTML = '<div class="empty" style="color:var(--danger);padding-top:14px;">No se pudo cargar el detalle de los ítems. Comprueba tu conexión.</div>';
    reportarError(e, { contexto: "abrirDetalleEvaluacion", evaluacion_id: ev.id });
  }
  enlazarAccionesDetalle(ev);
}

async function cargarYPintarItemsDetalle(ev){
  const respuestas = await cargarRespuestasEvaluacion(ev.id);
  const porCategoria = {};
  respuestas.forEach(r => {
    const item = Array.isArray(r.items_evaluacion) ? r.items_evaluacion[0] : r.items_evaluacion;
    if (!item) return;
    if (!porCategoria[item.categoria]) porCategoria[item.categoria] = [];
    porCategoria[item.categoria].push({ id: r.item_id, nombre: item.nombre, orden: item.orden, valor: r.valor });
  });
  Object.keys(porCategoria).forEach(cat => porCategoria[cat].sort((a,b) => a.orden - b.orden));
  detalleItemsActuales = porCategoria;

  let itemsHtml = "";
  CATEGORY_ORDER.forEach(cat => {
    const media = ev[CATEGORY_COL[cat]];
    itemsHtml += '<div class="detalle-cat-title">' + cat + ' · Media: ' + (media === null || media === undefined ? 'N/D' : fmt(media)) + '</div>';
    const items = porCategoria[cat] || [];
    if (items.length === 0){
      itemsHtml += '<div class="empty" style="padding:6px 0;">Sin ítems registrados.</div>';
    } else {
      itemsHtml += items.map(it =>
        '<div class="resumen-item"><span class="etiqueta">' + it.nombre + '</span><span class="valor">' + (it.valor === null || it.valor === undefined ? 'N/D' : fmt(it.valor)) + '</span></div>'
      ).join("");
    }
  });
  document.getElementById("detalleItemsContenido").innerHTML = itemsHtml;
}

// Historial de equipos del portero: se deduce de sus propias evaluaciones a lo largo del
// tiempo (cada evaluación ya guarda el equipo que tenía en ese momento), sin necesidad de
// guardar un "equipo actual" aparte que perdería ese histórico al sobrescribirse.
function construirHistorialEquipos(ev){
  if (!ev.portero_id) return "";
  const delMismoPortero = evaluacionesCargadas.filter(e => e.portero_id === ev.portero_id);
  if (delMismoPortero.length === 0) return "";

  const puntos = delMismoPortero.map(e => ({
    equipo: nombreEquipoDe(e) || "—",
    fecha: e.fecha_partido || (e.created_at ? e.created_at.slice(0,10) : "")
  })).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));

  // Colapsa fechas/equipos consecutivos iguales para no repetir líneas
  const filas = [];
  puntos.forEach(p => {
    const anterior = filas[filas.length - 1];
    if (!anterior || anterior.equipo !== p.equipo) filas.push({ equipo: p.equipo, desde: p.fecha, hasta: p.fecha });
    else anterior.hasta = p.fecha;
  });

  if (filas.length <= 1) return "";

  let html = '<div class="detalle-cat-title">Historial de equipos</div>';
  html += filas.map(f => {
    const rango = f.desde === f.hasta ? (f.desde || "—") : (f.desde || "—") + " → " + (f.hasta || "—");
    return '<div class="resumen-item"><span class="etiqueta">' + f.equipo + '</span><span class="valor" style="font-weight:400;color:var(--text-muted);">' + rango + '</span></div>';
  }).join("");
  return html;
}

function enlazarAccionesDetalle(ev){
  const btnEditar = document.getElementById("btnEditarPortero");
  if (btnEditar) btnEditar.onclick = () => mostrarFormularioEdicionPortero(ev);

  const btnEditarItems = document.getElementById("btnEditarItems");
  if (btnEditarItems) btnEditarItems.onclick = () => mostrarFormularioEdicionItems(ev);

  const btnEliminar = document.getElementById("btnEliminarEvaluacion");
  if (btnEliminar) btnEliminar.onclick = () => confirmarEliminarEvaluacion(ev);
}

function mostrarFormularioEdicionPortero(ev){
  const cont = document.getElementById("editarPorteroForm");
  const nombreActual = nombrePorteroDe(ev);
  const lateralidadActual = porteroCampo(ev, "lateralidad") || "N/D";

  cont.innerHTML =
    '<div class="edicion-portero">' +
      '<div class="field-group">' +
        '<label for="editNombrePortero">Nombre del portero</label>' +
        '<input type="text" id="editNombrePortero" value="' + nombreActual.replace(/"/g, "&quot;") + '">' +
      '</div>' +
      '<div class="field-group">' +
        '<label>Lateralidad</label>' +
        '<div class="radio-group">' +
          '<label class="radio-option"><input type="radio" name="editLateralidad" value="Derecha" ' + (lateralidadActual === "Derecha" ? "checked" : "") + '> Derecha</label>' +
          '<label class="radio-option"><input type="radio" name="editLateralidad" value="Izquierda" ' + (lateralidadActual === "Izquierda" ? "checked" : "") + '> Izquierda</label>' +
          '<label class="radio-option"><input type="radio" name="editLateralidad" value="N/D" ' + (lateralidadActual === "N/D" ? "checked" : "") + '> N/D</label>' +
        '</div>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn-secondary" id="cancelarEdicionPortero">Cancelar</button>' +
        '<button class="btn-primary" id="guardarEdicionPortero">Guardar cambios</button>' +
      '</div>' +
      '<div id="edicionPorteroError" class="login-error"></div>' +
    '</div>';

  document.getElementById("cancelarEdicionPortero").addEventListener("click", () => { cont.innerHTML = ""; });
  document.getElementById("guardarEdicionPortero").addEventListener("click", () => guardarEdicionPortero(ev));
}

async function guardarEdicionPortero(ev){
  const nuevoNombre = document.getElementById("editNombrePortero").value.trim();
  const lateralidadEl = document.querySelector('input[name="editLateralidad"]:checked');
  const errorEl = document.getElementById("edicionPorteroError");
  if (!nuevoNombre){
    errorEl.textContent = "El nombre no puede quedar vacío.";
    return;
  }
  const nuevaLateralidad = lateralidadEl ? lateralidadEl.value : "N/D";

  try {
    const token = await obtenerAccessToken();
    const res = await fetch(SUPABASE_URL + "/functions/v1/editar-portero", {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ portero_id: ev.portero_id, nombre: nuevoNombre, lateralidad: nuevaLateralidad })
    });
    if (!res.ok){
      let mensaje = "HTTP " + res.status;
      try { const cuerpo = await res.json(); if (cuerpo.error) mensaje = cuerpo.error; } catch(e){}
      throw new Error(mensaje);
    }

    // Refleja el cambio en todas las evaluaciones cargadas de este mismo portero
    evaluacionesCargadas.forEach(e => {
      if (e.portero_id !== ev.portero_id) return;
      const p = Array.isArray(e.porteros) ? e.porteros[0] : e.porteros;
      if (p){ p.nombre = nuevoNombre; p.lateralidad = nuevaLateralidad; }
    });

    document.getElementById("editarPorteroForm").innerHTML = "";
    pintarListaGuardadas(document.getElementById("buscarGuardadas").value);
    abrirDetalleEvaluacion(ev);
    setStatus("Datos del portero actualizados.", "var(--success)");
  } catch(e){
    errorEl.textContent = "No se pudo guardar: " + e.message;
    reportarError(e, { contexto: "guardarEdicionPortero", portero_id: ev.portero_id });
  }
}

// --- Edición de puntuaciones de una evaluación (solo coordinador) ---
// Usa sus propias clases CSS/listeners (no ".slider"/".nd-btn") para no interferir con los
// listeners globales del formulario principal de captura.

let valoresEdicionItems = {}; // item_id -> { nd, val }

function mostrarFormularioEdicionItems(ev){
  const cont = document.getElementById("editarItemsForm");

  valoresEdicionItems = {};
  CATEGORY_ORDER.forEach(cat => {
    (detalleItemsActuales[cat] || []).forEach(it => {
      valoresEdicionItems[it.id] = { nd: it.valor === null || it.valor === undefined, val: (it.valor === null || it.valor === undefined) ? 2.5 : it.valor };
    });
  });

  cont.innerHTML = '<div class="edicion-items" id="edicionItemsCuerpo"></div>' +
    '<div class="actions" style="margin-top:10px;">' +
      '<button class="btn-secondary" id="cancelarEdicionItems">Cancelar</button>' +
      '<button class="btn-primary" id="guardarEdicionItems">Guardar puntuaciones</button>' +
    '</div>' +
    '<div id="edicionItemsError" class="login-error"></div>';

  renderFormularioEdicionItems();

  document.getElementById("cancelarEdicionItems").addEventListener("click", () => { cont.innerHTML = ""; });
  document.getElementById("guardarEdicionItems").addEventListener("click", () => guardarEdicionItems(ev));
}

function renderFormularioEdicionItems(){
  const cuerpo = document.getElementById("edicionItemsCuerpo");
  let html = "";
  CATEGORY_ORDER.forEach(cat => {
    const items = detalleItemsActuales[cat] || [];
    if (items.length === 0) return;
    const vals = items.map(it => valoresEdicionItems[it.id]).filter(v => v && !v.nd).map(v => v.val);
    const avg = vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
    html += '<div class="detalle-cat-title">' + cat + ' · Media: ' + (avg === null ? 'N/D' : fmt(avg)) + '</div>';
    items.forEach(it => {
      const v = valoresEdicionItems[it.id];
      html += '<div class="item-row">';
      html += '<div class="item-top"><span class="item-name">' + it.nombre + '</span><span class="item-val ' + (v.nd ? 'nd' : 'set') + '">' + (v.nd ? 'N/D' : fmt(v.val)) + '</span></div>';
      html += '<div class="item-controls">';
      html += '<input type="range" min="0" max="5" step="0.5" value="' + v.val + '" data-edititem="' + it.id + '" class="slider-edit" ' + (v.nd ? 'disabled' : '') + '>';
      html += '<button class="nd-btn-edit ' + (v.nd ? 'active' : '') + '" data-ndedit="' + it.id + '">N/D</button>';
      html += '</div></div>';
    });
  });
  cuerpo.innerHTML = html;

  cuerpo.querySelectorAll(".slider-edit").forEach(s => {
    s.addEventListener("input", e => {
      valoresEdicionItems[e.target.dataset.edititem].val = parseFloat(e.target.value);
      renderFormularioEdicionItems();
    });
  });
  cuerpo.querySelectorAll(".nd-btn-edit").forEach(b => {
    b.addEventListener("click", e => {
      const id = e.target.dataset.ndedit;
      valoresEdicionItems[id].nd = !valoresEdicionItems[id].nd;
      renderFormularioEdicionItems();
    });
  });
}

async function guardarEdicionItems(ev){
  const errorEl = document.getElementById("edicionItemsError");
  const respuestas = Object.keys(valoresEdicionItems)
    .filter(id => !valoresEdicionItems[id].nd)
    .map(id => ({ item_id: id, valor: valoresEdicionItems[id].val }));

  try {
    const token = await obtenerAccessToken();
    const res = await fetch(SUPABASE_URL + "/functions/v1/editar-evaluacion", {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ evaluacion_id: ev.id, respuestas })
    });
    if (!res.ok){
      let mensaje = "HTTP " + res.status;
      try { const cuerpo = await res.json(); if (cuerpo.error) mensaje = cuerpo.error; } catch(e){}
      throw new Error(mensaje);
    }
    const resultado = await res.json();

    // Refleja las nuevas medias en la evaluación cargada localmente
    Object.assign(ev, resultado.medias || {});

    document.getElementById("editarItemsForm").innerHTML = "";
    await cargarYPintarItemsDetalle(ev);
    setStatus("Puntuaciones actualizadas.", "var(--success)");
  } catch(e){
    errorEl.textContent = "No se pudo guardar: " + e.message;
    reportarError(e, { contexto: "guardarEdicionItems", evaluacion_id: ev.id });
  }
}

function confirmarEliminarEvaluacion(ev){
  const nombre = nombrePorteroDe(ev);
  if (!confirm('¿Eliminar definitivamente la evaluación de "' + nombre + '"? Esta acción no se puede deshacer.')) return;
  eliminarEvaluacion(ev);
}

async function eliminarEvaluacion(ev){
  try {
    const token = await obtenerAccessToken();
    const res = await fetch(SUPABASE_URL + "/functions/v1/eliminar-evaluacion", {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ evaluacion_id: ev.id })
    });
    if (!res.ok){
      let mensaje = "HTTP " + res.status;
      try { const cuerpo = await res.json(); if (cuerpo.error) mensaje = cuerpo.error; } catch(e){}
      throw new Error(mensaje);
    }
    evaluacionesCargadas = evaluacionesCargadas.filter(e => e.id !== ev.id);
    document.getElementById("modalDetalle").style.display = "none";
    pintarListaGuardadas(document.getElementById("buscarGuardadas").value);
    setStatus("Evaluación eliminada.", "var(--success)");
  } catch(e){
    setStatus("No se pudo eliminar: " + e.message, "var(--danger)");
    reportarError(e, { contexto: "eliminarEvaluacion", evaluacion_id: ev.id });
  }
}

document.getElementById("savedList").addEventListener("click", e => {
  const row = e.target.closest(".saved-row");
  if (!row) return;
  const ev = evaluacionesCargadas.find(x => String(x.id) === String(row.dataset.id));
  if (ev) abrirDetalleEvaluacion(ev);
});

document.getElementById("cerrarDetalle").addEventListener("click", () => {
  document.getElementById("modalDetalle").style.display = "none";
});

document.getElementById("modalDetalle").addEventListener("click", e => {
  if (e.target.id === "modalDetalle") document.getElementById("modalDetalle").style.display = "none";
});

function setStatus(msg, color){
  const s = document.getElementById("status");
  s.textContent = msg;
  s.style.color = color || "var(--text-secondary)";
}

let pendienteGuardar = null;

document.getElementById("guardar").addEventListener("click", () => {
  if (!modalidadSeleccionada){
    setStatus("Elige una modalidad (F7 o F11) antes de guardar.", "var(--danger)");
    return;
  }

  const evaluadorEl = document.getElementById("evaluador");
  const evaluador = evaluadorEl.value.trim();
  if (!evaluador){
    setStatus("No se ha podido identificar tu perfil de técnico. Recarga la página.", "var(--danger)");
    return;
  }

  const nombreEl = document.getElementById("nombre");
  const nombre = nombreEl.value.trim();
  if (!nombre){
    setStatus("El nombre del portero es obligatorio.", "var(--danger)");
    nombreEl.style.borderColor = "var(--danger)";
    nombreEl.focus();
    return;
  }
  nombreEl.style.borderColor = "";

  const anioEl = document.getElementById("anioNacimiento");
  const anioNacimiento = parseInt(anioEl.value, 10) || null;
  if (!anioNacimiento){
    setStatus("El año de nacimiento es obligatorio.", "var(--danger)");
    anioEl.style.borderColor = "var(--danger)";
    anioEl.focus();
    return;
  }
  anioEl.style.borderColor = "";

  const equipoEl = document.getElementById("equipo");
  const equipo = equipoEl.value.trim();
  if (!equipo){
    setStatus("El equipo es obligatorio.", "var(--danger)");
    equipoEl.style.borderColor = "var(--danger)";
    equipoEl.focus();
    return;
  }
  equipoEl.style.borderColor = "";

  const lateralidad = document.querySelector('input[name="lateralidad"]:checked').value;
  const fechaInput = document.getElementById("fecha").value;
  const visionado = document.querySelector('input[name="visionado"]:checked').value;
  const partidoEl = document.getElementById("partido");
  const partido = partidoEl.value.trim();
  if (!partido){
    setStatus("El partido es obligatorio.", "var(--danger)");
    partidoEl.style.borderColor = "var(--danger)";
    partidoEl.focus();
    return;
  }
  partidoEl.style.borderColor = "";

  const observacionesEl = document.getElementById("observaciones");
  const observaciones = observacionesEl.value.trim();
  const evalFinalEl = document.querySelector('input[name="evalFinal"]:checked');
  const evalFinalGroup = document.getElementById("evalFinalGroup");
  if (!evalFinalEl){
    setStatus("La evaluación final es obligatoria.", "var(--danger)");
    evalFinalGroup.style.outline = "2px solid var(--danger)";
    evalFinalGroup.style.borderRadius = "10px";
    evalFinalGroup.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  evalFinalGroup.style.outline = "";
  const evaluacionFinal = evalFinalEl.value;

  if (evaluacionFinal === "D" && !observaciones){
    setStatus("Las observaciones son obligatorias cuando la evaluación final es D.", "var(--danger)");
    observacionesEl.style.borderColor = "var(--danger)";
    observacionesEl.focus();
    observacionesEl.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  observacionesEl.style.borderColor = "";

  const row = {
    fecha_partido: fechaInput || null,
    tipo_visionado: visionado,
    partido: partido || null,
    observaciones: observaciones || null,
    evaluacion_final: evaluacionFinal,
    modalidad_id: modalidadSeleccionada.id
  };
  DATA.forEach(sec => {
    const avg = categoryAverage(sec);
    row[sec.col] = avg === null ? null : Math.round(avg * 100) / 100;
  });

  const respuestas = [];
  DATA.forEach(sec => sec.items.forEach(it => {
    const v = valores[it.id];
    if (!v.nd) respuestas.push({ item_id: it.id, valor: v.val });
  }));

  pendienteGuardar = { row, respuestas, evaluador, nombre, equipo, anioNacimiento, lateralidad };

  mostrarRepaso();
});

function calcularAvisosCalidad(p){
  // Con evaluación final "D" no es necesario puntuar ningún ítem, así que no tiene sentido
  // avisar de que faltan por rellenar.
  if (p.row.evaluacion_final === "D") return [];

  const avisos = [];
  const totalItems = DATA.reduce((n, sec) => n + sec.items.length, 0);
  const totalPuntuados = p.respuestas.length;

  const seccionesVacias = DATA.filter(sec => sec.items.every(it => valores[it.id].nd));
  const seccionesConDatos = DATA.filter(sec => sec.items.some(it => !valores[it.id].nd));
  if (seccionesVacias.length > 0 && seccionesConDatos.length > 0){
    avisos.push("No has puntuado ningún ítem en: " + seccionesVacias.map(s => s.cat).join(", ") + ". ¿Ha sido intencionado?");
  }

  if (totalItems > 0 && totalPuntuados / totalItems < 0.5){
    avisos.push("Solo has puntuado " + totalPuntuados + " de " + totalItems + " ítems en total. Revisa que no se te haya olvidado nada.");
  }

  return avisos;
}

function mostrarRepaso(){
  const p = pendienteGuardar;
  const totalItems = DATA.reduce((n, sec) => n + sec.items.length, 0);
  const itemsPuntuados = p.respuestas.length;

  const filas = [
    ["Técnico", p.evaluador],
    ["Portero", p.nombre],
    ["Año de nacimiento", p.anioNacimiento],
    ["Lateralidad", p.lateralidad],
    ["Equipo", p.equipo],
    ["Modalidad", modalidadSeleccionada.nombre],
    ["Fecha", p.row.fecha_partido || "—"],
    ["Tipo de visionado", p.row.tipo_visionado],
    ["Partido", p.row.partido],
    ["Evaluación final", p.row.evaluacion_final || "N/D"]
  ];
  filas.push(["Ítems puntuados", itemsPuntuados + " de " + totalItems]);
  if (p.row.observaciones) filas.push(["Observaciones", p.row.observaciones]);

  const cabeceraHtml = filas.map(([etq, val]) =>
    '<div class="resumen-item"><span class="etiqueta">' + etq + '</span><span class="valor">' + val + '</span></div>'
  ).join("");

  // Desglose ítem a ítem agrupado por categoría, con la media de cada una
  let itemsHtml = "";
  DATA.forEach(sec => {
    const media = p.row[sec.col];
    itemsHtml += '<div class="detalle-cat-title">' + sec.cat + ' · Media: ' + (media === null ? 'N/D' : fmt(media)) + '</div>';
    itemsHtml += sec.items.map(it => {
      const v = valores[it.id];
      const valorTexto = v.nd ? 'N/D' : fmt(v.val);
      return '<div class="resumen-item"><span class="etiqueta">' + it.nombre + '</span><span class="valor">' + valorTexto + '</span></div>';
    }).join("");
  });

  const avisos = calcularAvisosCalidad(p);
  const avisosHtml = avisos.map(a => '<div class="resumen-aviso resumen-aviso-danger">⚠️ ' + a + '</div>').join("");

  document.getElementById("resumenRepaso").innerHTML = cabeceraHtml + itemsHtml + avisosHtml +
    '<div class="resumen-aviso">Comprueba que todo esté correcto: una vez guardada, la evaluación no se puede eliminar ni editar desde la app.</div>';

  document.getElementById("modalRepaso").style.display = "flex";
}

document.getElementById("volverEditar").addEventListener("click", () => {
  document.getElementById("modalRepaso").style.display = "none";
});

// Realiza el guardado real: llama a la Edge Function "guardar-evaluacion", que se ejecuta
// en el servidor con permisos elevados (service_role) y resuelve ahí los IDs de técnico/
// portero/equipo y crea la evaluación + sus respuestas. El navegador nunca escribe directamente
// en las tablas (las políticas RLS solo permiten lectura a usuarios autenticados).
// Se usa tanto al guardar en el momento como al sincronizar evaluaciones pendientes offline.
async function guardarEnSupabase(p){
  const token = await obtenerAccessToken();
  if (!token) throw new Error("Sesión no válida. Vuelve a iniciar sesión.");

  let res;
  try {
    res = await fetch(SUPABASE_URL + "/functions/v1/guardar-evaluacion", {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        nombre: p.nombre,
        lateralidad: p.lateralidad,
        anioNacimiento: p.anioNacimiento,
        equipo: p.equipo,
        row: p.row,
        respuestas: p.respuestas
      })
    });
  } catch(errRed){
    // fetch() ha lanzado antes de recibir respuesta: es un fallo de red real (sin conexión).
    throw errRed;
  }

  if (!res.ok){
    let mensaje = "HTTP " + res.status;
    try { const cuerpo = await res.json(); if (cuerpo.error) mensaje = cuerpo.error; } catch(e){}
    const error = new Error(mensaje);
    // La petición SÍ ha llegado al servidor y este la ha rechazado (datos inválidos, sesión
    // caducada, permisos...). Reintentarla sin cambiar nada no lo va a arreglar, así que no
    // debe tratarse como "sin conexión".
    error.esRechazoServidor = true;
    throw error;
  }
}

document.getElementById("confirmarGuardar").addEventListener("click", async () => {
  if (!pendienteGuardar) return;
  const p = pendienteGuardar;
  const confirmarBtn = document.getElementById("confirmarGuardar");
  confirmarBtn.disabled = true;
  confirmarBtn.textContent = "Guardando…";
  try {
    await guardarEnSupabase(p);
    document.getElementById("modalRepaso").style.display = "none";
    setStatus("Evaluación guardada correctamente.", "var(--success)");
    resetForm();
    renderSavedList();
    cargarListaPorteros();
    cargarListaEquipos();
    cargarListaTecnicos();
    pendienteGuardar = null;
  } catch(err){
    if (err.esRechazoServidor){
      // El servidor ha rechazado la evaluación por un motivo real: se lo mostramos tal cual
      // al técnico para que lo corrija, sin guardarlo en la cola offline ni cerrar el modal.
      setStatus(err.message, "var(--danger)");
      reportarError(err, { contexto: "guardar-evaluacion", motivo: "rechazo_servidor" });
      confirmarBtn.disabled = false;
      confirmarBtn.textContent = "Confirmar y guardar";
      return;
    }
    // No se pudo llegar al servidor (sin conexión, red inestable...): guardamos la evaluación
    // en el dispositivo y la subiremos automáticamente en cuanto se recupere la conexión.
    guardarPendienteOffline(p);
    document.getElementById("modalRepaso").style.display = "none";
    setStatus("Sin conexión: la evaluación se ha guardado en el dispositivo y se subirá sola en cuanto haya red.", "var(--accent)");
    resetForm();
    pendienteGuardar = null;
  }
  confirmarBtn.disabled = false;
  confirmarBtn.textContent = "Confirmar y guardar";
});

function resetForm(){
  document.getElementById("nombre").value = "";
  document.getElementById("sugerencias").style.display = "none";
  document.getElementById("equipo").value = "";
  document.getElementById("sugerenciasEquipo").style.display = "none";
  document.querySelector('input[name="lateralidad"][value="N/D"]').checked = true;
  document.getElementById("anioNacimiento").value = "";
  document.getElementById("fecha").value = new Date().toISOString().slice(0,10);
  document.querySelector('input[name="visionado"][value="Directo"]').checked = true;
  document.getElementById("partido").value = "";
  document.getElementById("observaciones").value = "";
  document.querySelectorAll('input[name="evalFinal"]').forEach(r => { r.checked = false; });
  DATA.forEach(s => s.items.forEach(it => { valores[it.id] = { nd: true, val: 2.5 }; }));
  renderForm();
  borrarBorrador();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Borrador local (recuperación ante cierre accidental) ----------

function recopilarEstadoFormulario(){
  if (!modalidadSeleccionada || document.getElementById("restoFormulario").style.display === "none") return null;
  const evalFinalEl = document.querySelector('input[name="evalFinal"]:checked');
  return {
    modalidadId: modalidadSeleccionada.id,
    modalidadNombre: modalidadSeleccionada.nombre,
    evaluador: document.getElementById("evaluador").value,
    nombre: document.getElementById("nombre").value,
    equipo: document.getElementById("equipo").value,
    lateralidad: document.querySelector('input[name="lateralidad"]:checked').value,
    anioNacimiento: document.getElementById("anioNacimiento").value,
    fecha: document.getElementById("fecha").value,
    visionado: document.querySelector('input[name="visionado"]:checked').value,
    partido: document.getElementById("partido").value,
    observaciones: document.getElementById("observaciones").value,
    evalFinal: evalFinalEl ? evalFinalEl.value : "",
    valores: valores,
    guardadoEn: new Date().toISOString()
  };
}

function estadoFormularioVacio(estado){
  const sinTexto = !(estado.nombre || "").trim() && !(estado.equipo || "").trim() &&
    !(estado.partido || "").trim() && !(estado.observaciones || "").trim();
  const sinPuntuaciones = !estado.valores || Object.values(estado.valores).every(v => v.nd);
  return sinTexto && sinPuntuaciones;
}

function guardarBorrador(){
  try {
    const estado = recopilarEstadoFormulario();
    if (!estado || estadoFormularioVacio(estado)){
      localStorage.removeItem(BORRADOR_KEY);
      return;
    }
    localStorage.setItem(BORRADOR_KEY, JSON.stringify(estado));
  } catch(e){ /* localStorage no disponible: sin borrador, sin bloquear la app */ }
}

function borrarBorrador(){
  try { localStorage.removeItem(BORRADOR_KEY); } catch(e){}
}

function aplicarCamposBorrador(borrador){
  // El técnico no se restaura desde el borrador: siempre es el de la sesión activa.
  document.getElementById("nombre").value = borrador.nombre || "";
  document.getElementById("equipo").value = borrador.equipo || "";
  const lat = document.querySelector('input[name="lateralidad"][value="' + borrador.lateralidad + '"]');
  if (lat) lat.checked = true;
  document.getElementById("anioNacimiento").value = borrador.anioNacimiento || "";
  document.getElementById("fecha").value = borrador.fecha || "";
  const vis = document.querySelector('input[name="visionado"][value="' + borrador.visionado + '"]');
  if (vis) vis.checked = true;
  document.getElementById("partido").value = borrador.partido || "";
  document.getElementById("observaciones").value = borrador.observaciones || "";
  if (borrador.evalFinal){
    const ev = document.querySelector('input[name="evalFinal"][value="' + borrador.evalFinal + '"]');
    if (ev) ev.checked = true;
  }
  if (borrador.valores){
    Object.keys(borrador.valores).forEach(id => {
      if (valores.hasOwnProperty(id)) valores[id] = borrador.valores[id];
    });
  }
  renderForm();
  setStatus("Borrador recuperado.", "var(--success)");
}

function intentarRestaurarBorrador(){
  let borrador = null;
  try {
    const guardado = localStorage.getItem(BORRADOR_KEY);
    if (guardado) borrador = JSON.parse(guardado);
  } catch(e){ borrador = null; }
  if (!borrador) return;

  // Comprobación defensiva: si por lo que sea el borrador guardado está realmente
  // vacío (sin texto ni puntuaciones), lo descartamos en silencio en vez de avisar.
  if (estadoFormularioVacio(borrador)){
    borrarBorrador();
    return;
  }

  const banner = document.getElementById("borradorBanner");
  let cuando = "";
  if (borrador.guardadoEn){
    try {
      const fecha = new Date(borrador.guardadoEn);
      cuando = " (guardada el " + fecha.toLocaleDateString() + " a las " + fecha.toLocaleTimeString().slice(0,5) + ")";
    } catch(e){}
  }
  document.getElementById("borradorTexto").textContent =
    "Tienes una evaluación sin guardar" + (borrador.nombre ? (" de " + borrador.nombre) : "") + cuando + ". ¿Continuarla?";
  banner.style.display = "flex";

  document.getElementById("continuarBorrador").onclick = () => {
    banner.style.display = "none";
    const radio = document.querySelector('input[name="modalidad"][value="' + borrador.modalidadId + '"]');
    if (!radio){
      setStatus("No se pudo recuperar la modalidad del borrador. Comprueba tu conexión.", "var(--danger)");
      return;
    }
    radio.checked = true;
    seleccionarModalidad(borrador.modalidadId, borrador.modalidadNombre).then(() => {
      aplicarCamposBorrador(borrador);
    });
  };
  document.getElementById("descartarBorrador").onclick = () => {
    borrarBorrador();
    banner.style.display = "none";
  };
}

// ---------- Cola de evaluaciones pendientes de subir (modo sin conexión) ----------

function obtenerColaPendientes(){
  try {
    const guardado = localStorage.getItem(PENDIENTES_KEY);
    return guardado ? JSON.parse(guardado) : [];
  } catch(e){ return []; }
}

function guardarColaPendientes(cola){
  try { localStorage.setItem(PENDIENTES_KEY, JSON.stringify(cola)); } catch(e){}
}

function guardarPendienteOffline(p){
  const cola = obtenerColaPendientes();
  cola.push(Object.assign({}, p, { guardadoEn: new Date().toISOString() }));
  guardarColaPendientes(cola);
  actualizarIndicadorPendientes();
}

function actualizarIndicadorPendientes(sincronizandoAhora){
  const banner = document.getElementById("pendientesBanner");
  const texto = document.getElementById("pendientesTexto");
  const n = obtenerColaPendientes().length;
  if (n === 0){
    banner.style.display = "none";
    return;
  }
  banner.style.display = "flex";
  const plural = n === 1 ? "" : "es";
  texto.textContent = sincronizandoAhora
    ? "Subiendo " + n + " evaluación" + plural + " pendiente" + (n === 1 ? "" : "s") + "…"
    : n + " evaluación" + plural + " pendiente" + (n === 1 ? "" : "s") + " de subir. Se subirán solas al recuperar conexión.";
}

let sincronizandoPendientes = false;

async function sincronizarPendientes(){
  if (sincronizandoPendientes) return;
  let cola = obtenerColaPendientes();
  if (cola.length === 0) return;

  sincronizandoPendientes = true;
  actualizarIndicadorPendientes(true);
  let algunaSubida = false;
  const rechazadas = [];

  let i = 0;
  while (i < cola.length){
    try {
      await guardarEnSupabase(cola[i]);
      cola.splice(i, 1);
      guardarColaPendientes(cola);
      algunaSubida = true;
      actualizarIndicadorPendientes(true);
    } catch(e){
      if (e.esRechazoServidor){
        // El servidor la ha rechazado de verdad (no es un problema de conexión): no tiene
        // sentido reintentarla sola. La sacamos de la cola y avisamos, para que no bloquee
        // a las demás evaluaciones pendientes detrás de ella.
        reportarError(e, { contexto: "sincronizar-pendiente", motivo: "rechazo_servidor" });
        rechazadas.push({ item: cola[i], motivo: e.message });
        cola.splice(i, 1);
        guardarColaPendientes(cola);
        continue;
      }
      // Fallo de red real: seguimos sin conexión. Paramos aquí y lo reintentamos más tarde,
      // dejando en la cola esta evaluación y las siguientes.
      break;
    }
  }

  sincronizandoPendientes = false;
  actualizarIndicadorPendientes();

  if (rechazadas.length > 0){
    const detalle = rechazadas.map(r => (r.item.nombre || "portero") + ": " + r.motivo).join(" · ");
    setStatus(rechazadas.length + " evaluación(es) pendiente(s) NO se pudieron subir y se han descartado de la cola: " + detalle + ". Coméntalo con el coordinador.", "var(--danger)");
  }

  if (algunaSubida){
    renderSavedList();
    cargarListaPorteros();
    cargarListaEquipos();
    cargarListaTecnicos();
  }
}

window.addEventListener("online", sincronizarPendientes);
document.getElementById("reintentarSync").addEventListener("click", sincronizarPendientes);
setInterval(sincronizarPendientes, 30000);

document.getElementById("exportar").addEventListener("click", async () => {
  setStatus("Preparando exportación…", "var(--text-secondary)");
  const list = await loadSaved();
  if (list === null){
    setStatus("No se ha podido conectar con la base de datos.", "var(--danger)");
    return;
  }
  if (list.length === 0){
    setStatus("No hay evaluaciones guardadas todavía.", "var(--text-secondary)");
    return;
  }

  // Traemos todas las respuestas (puntuaciones ítem a ítem) de estas evaluaciones en una sola consulta
  const ids = list.map(ev => ev.id).join(",");
  let respuestasPorEvaluacion = {};
  let columnasItems = []; // lista ordenada de nombres de ítem únicos encontrados
  try {
    const res = await fetch(
      SUPABASE_URL + "/rest/v1/respuestas_evaluacion?select=evaluacion_id,valor,items_evaluacion(nombre,categoria,orden)&evaluacion_id=in.(" + ids + ")",
      { headers: sbHeaders() }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    const respuestas = await res.json();

    const vistos = new Set();
    respuestas.forEach(r => {
      const item = Array.isArray(r.items_evaluacion) ? r.items_evaluacion[0] : r.items_evaluacion;
      if (!item) return;
      if (!respuestasPorEvaluacion[r.evaluacion_id]) respuestasPorEvaluacion[r.evaluacion_id] = {};
      respuestasPorEvaluacion[r.evaluacion_id][item.nombre] = r.valor;
      if (!vistos.has(item.nombre)){
        vistos.add(item.nombre);
        columnasItems.push({ nombre: item.nombre, categoria: item.categoria, orden: item.orden });
      }
    });
    columnasItems.sort((a,b) => {
      const ca = CATEGORY_ORDER.indexOf(a.categoria), cb = CATEGORY_ORDER.indexOf(b.categoria);
      if (ca !== cb) return ca - cb;
      return a.orden - b.orden;
    });
  } catch(e){
    setStatus("No se pudieron cargar las puntuaciones para exportar.", "var(--danger)");
    reportarError(e, { contexto: "exportarCSV" });
    return;
  }

  const nombresItems = columnasItems.map(c => c.nombre);
  const headers = ["Técnico", "Nombre", "Lateralidad", "Año nacimiento", "Equipo", "Modalidad", "Fecha", "Tipo de visionado", "Partido", "Observaciones", "Evaluación final"]
    .concat(CATEGORY_ORDER.map(cat => "Media " + cat))
    .concat(nombresItems);
  const rows = [headers];
  list.forEach(ev => {
    const modalidadNombre = ev.modalidades ? (Array.isArray(ev.modalidades) ? (ev.modalidades[0] ? ev.modalidades[0].nombre : "") : ev.modalidades.nombre) : "";
    const row = [
      nombreTecnicoDe(ev),
      nombrePorteroDe(ev),
      porteroCampo(ev, "lateralidad") || "N/D",
      porteroCampo(ev, "anio_nacimiento"),
      nombreEquipoDe(ev),
      modalidadNombre,
      ev.fecha_partido || (ev.created_at ? ev.created_at.slice(0,10) : ""),
      ev.tipo_visionado || "",
      ev.partido || "",
      ev.observaciones || "",
      ev.evaluacion_final || ""
    ];
    CATEGORY_ORDER.forEach(cat => {
      const v = ev[CATEGORY_COL[cat]];
      row.push((v === null || v === undefined) ? "N/D" : String(v).replace(".", ","));
    });
    const respuestasEv = respuestasPorEvaluacion[ev.id] || {};
    nombresItems.forEach(nombreItem => {
      const v = respuestasEv[nombreItem];
      row.push((v === null || v === undefined) ? "N/D" : String(v).replace(".", ","));
    });
    rows.push(row);
  });

  const csv = rows.map(r => r.map(cell => {
    const s = String(cell).replace(/"/g, '""');
    return /[",;\n]/.test(s) ? '"' + s + '"' : s;
  }).join(";")).join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "evaluaciones_porteros.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setStatus("Archivo exportado (" + list.length + " evaluación/es). Ábrelo con Excel o Google Sheets.", "var(--success)");
});

function iniciarApp(){
  document.getElementById("fecha").value = new Date().toISOString().slice(0,10);

  cargarPerfilActual();
  cargarModalidades().then(intentarRestaurarBorrador);
  renderSavedList();
  cargarListaPorteros();
  cargarListaEquipos();
  cargarListaTecnicos();
  actualizarIndicadorPendientes();
  sincronizarPendientes();

  // Autoguardado del borrador: cualquier cambio en los campos del formulario (texto o radios),
  // más un intervalo de seguridad por si algún cambio no dispara los eventos anteriores.
  document.getElementById("restoFormulario").addEventListener("input", guardarBorrador);
  document.getElementById("restoFormulario").addEventListener("change", guardarBorrador);
  setInterval(guardarBorrador, 8000);
}

function activarAutocompletado(inputEl, contenedorEl, obtenerLista){
  function mostrar(){
    const filtro = inputEl.value.trim().toLowerCase();
    if (!filtro){
      contenedorEl.style.display = "none";
      contenedorEl.innerHTML = "";
      return;
    }
    const coincidencias = obtenerLista().filter(n => n.toLowerCase().includes(filtro));
    if (coincidencias.length === 0){
      contenedorEl.style.display = "none";
      contenedorEl.innerHTML = "";
      return;
    }
    contenedorEl.innerHTML = coincidencias.map(n =>
      '<div class="suggestion-item">' + n.replace(/</g,"&lt;") + '</div>'
    ).join("");
    contenedorEl.style.display = "block";
  }

  inputEl.addEventListener("input", mostrar);
  inputEl.addEventListener("focus", mostrar);

  contenedorEl.addEventListener("click", e => {
    const item = e.target.closest(".suggestion-item");
    if (!item) return;
    inputEl.value = item.textContent;
    contenedorEl.style.display = "none";
    contenedorEl.innerHTML = "";
  });

  document.addEventListener("click", e => {
    if (e.target !== inputEl && !contenedorEl.contains(e.target)){
      contenedorEl.style.display = "none";
    }
  });
}

activarAutocompletado(document.getElementById("nombre"), document.getElementById("sugerencias"), () => porterosDisponibles);
activarAutocompletado(document.getElementById("equipo"), document.getElementById("sugerenciasEquipo"), () => equiposDisponibles);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
