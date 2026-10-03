// Interfaz mínima para demostrar el flujo: matrícula → mensualidad → pago →
// comprobante → mora. Sin frameworks: solo fetch a la API y plantillas HTML.

// ---------- utilidades ----------

const $ = (selector, raiz = document) => raiz.querySelector(selector);
const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dinero = (valor) => `$${Number(valor ?? 0).toFixed(2)}`;
const mes = (anio, numero) => `${MESES[numero]} ${anio}`;
const hoy = () => new Date().toLocaleDateString('en-CA');
const fecha = (texto) => (texto
  ? new Date(texto.length === 10 ? `${texto}T00:00:00` : texto)
    .toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })
  : '');
const fechaHora = (texto) => new Date(texto).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
// Montos en centavos para sumar sin errores de coma flotante.
const centavos = (valor) => Math.round(Number(valor || 0) * 100);

const motor = (nombre) => `<span class="motor ${nombre === 'MongoDB' ? 'mongo' : 'pg'}">${nombre}</span>`;
const insignia = (estado) => `<span class="estado estado-${esc(estado)}">${esc(String(estado).replaceAll('_', ' '))}</span>`;
const json = (documento) => `<pre class="json">${esc(JSON.stringify(documento, null, 2))}</pre>`;

function tabla(columnas, filas, vacio = 'Sin registros') {
  if (!filas.length) return `<p class="vacio">${vacio}</p>`;
  const celda = (etiqueta, c, contenido) => `<${etiqueta}${c.num ? ' class="num"' : ''}>${contenido}</${etiqueta}>`;
  return `<div class="tabla-scroll"><table>
    <thead><tr>${columnas.map((c) => celda('th', c, c.titulo)).join('')}</tr></thead>
    <tbody>${filas.map((f) => `<tr>${columnas.map((c) => celda('td', c, c.valor(f))).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  const respuesta = await fetch(`/api${ruta}`, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw Object.assign(new Error(datos.error ?? `Error ${respuesta.status}`), { datos });
  }
  return datos;
}

function htmlReglas(reglas) {
  if (!reglas?.length) return '';
  return `<ul class="reglas">${reglas.map((regla) => {
    const [campo, ...detalle] = regla.split(': ');
    return `<li><code>${esc(campo)}</code> ${esc(detalle.join(': '))}</li>`;
  }).join('')}</ul>`;
}

function htmlError(err) {
  const d = err.datos ?? {};
  return `<div class="alerta error">
    <strong>${d.motor ? `Rechazado por ${motor(d.motor)}` : 'No se pudo completar'}</strong>
    <p>${esc(err.message)}</p>
    ${htmlReglas(d.reglas)}
    ${d.motor === 'PostgreSQL' ? '<p class="detalle">La transacción se revirtió completa: no se guardó nada.</p>' : ''}
  </div>`;
}


async function enviar(formulario, contenedor, accion) {
  const boton = $('button[type=submit]', formulario);
  boton.disabled = true;
  try {
    await accion();
  } catch (err) {
    contenedor.innerHTML = htmlError(err);
  } finally {
    boton.disabled = false;
  }
}

function llenarSelect(select, opciones, { vacio } = {}) {
  const previo = select.value;
  select.innerHTML = (vacio ? `<option value="">${esc(vacio)}</option>` : '')
    + opciones.map(([valor, texto]) => `<option value="${esc(valor)}">${esc(texto)}</option>`).join('');
  if ([...select.options].some((o) => o.value === previo)) select.value = previo;
}

function camposComprobante(campos, valores = {}) {
  return campos.map((c) => {
    const nombre = `comprobante.${c.nombre}`;
    const requerido = c.requerido ? ' required' : '';
    if (c.tipo === 'opcion') {
      return `<label>${esc(c.etiqueta)}<select name="${nombre}"${requerido}>
        ${c.opciones.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>`;
    }
    const tipo = { fecha: 'date', dinero: 'number' }[c.tipo] ?? 'text';
    const extra = c.tipo === 'dinero' ? ' step="0.01" min="0.01"' : '';
    const valor = valores[c.nombre] ?? (c.tipo === 'fecha' ? hoy() : '');
    const ayuda = c.ayuda ? ` placeholder="${esc(c.ayuda)}"` : '';
    return `<label>${esc(c.etiqueta)}<input type="${tipo}" name="${nombre}" value="${esc(valor)}"${ayuda}${extra}${requerido}></label>`;
  }).join('');
}

function leerComprobante(formulario) {
  const comprobante = {};
  for (const [clave, valor] of new FormData(formulario)) {
    if (clave.startsWith('comprobante.')) comprobante[clave.slice('comprobante.'.length)] = valor;
  }
  return comprobante;
}

// ---------- estado y navegación ----------

let catalogos = { cursos: [], alumnos: [], representantes: [], metodos_pago: [] };

async function cargarCatalogos() {
  catalogos = await api('/catalogos');
  llenarSelect($('#form-matricula [name=id_alumno]'),
    catalogos.alumnos.map((a) => [a.id_alumno, `${a.nombres} · ${a.edad} años`]));
  llenarSelect($('#form-matricula [name=id_curso]'),
    catalogos.cursos.map((c) => [c.id_curso, `${c.nombre} · ${c.edad_min}–${c.edad_max} años · ${c.ocupados}/${c.cupo_maximo}`]));
  const representantes = catalogos.representantes.map((r) => [r.id_representante, r.nombres]);
  llenarSelect($('#form-pago [name=id_representante]'), representantes, { vacio: 'Elige un representante' });
  llenarSelect($('#cuenta-representante'), representantes, { vacio: 'Elige un representante' });
  llenarSelect($('#form-pago [name=id_metodo_pago]'),
    catalogos.metodos_pago.map((m) => [m.id_metodo_pago, m.nombre]));
  renderCursos();
}

function activar(pestana) {
  $$('.pestanas button').forEach((b) => b.classList.toggle('activa', b.dataset.pestana === pestana));
  $$('.panel').forEach((p) => p.classList.toggle('activa', p.id === pestana));
  history.replaceState(null, '', `#${pestana}`);
  if (pestana === 'mora') cargarMora();
  if (pestana === 'pagos') cargarPendientes();
  if (pestana === 'cuenta') cargarCuenta();
}

// ---------- 1 · Matrícula (R1) ----------

function renderCursos() {
  $('#tabla-cursos').innerHTML = tabla([
    { titulo: 'Curso', valor: (c) => esc(c.nombre) },
    { titulo: 'Edades', valor: (c) => `${c.edad_min}–${c.edad_max}` },
    { titulo: 'Horario', valor: (c) => esc(c.horario) },
    { titulo: 'Cupo', num: true, valor: (c) => `${c.ocupados} / ${c.cupo_maximo}` },
    { titulo: 'Mensualidad', num: true, valor: (c) => dinero(c.valor_mensual) },
  ], catalogos.cursos);
}

$('#form-matricula').addEventListener('submit', (evento) => {
  evento.preventDefault();
  const formulario = evento.target;
  const contenedor = $('#resultado-matricula');
  enviar(formulario, contenedor, async () => {
    const r = await api('/matriculas', { metodo: 'POST', cuerpo: Object.fromEntries(new FormData(formulario)) });
    contenedor.innerHTML = `<div class="alerta ok"><strong>Matrícula #${r.id_matricula} creada</strong>
      <p>${r.mensualidades_generadas} mensualidad(es) generada(s) en la misma transacción.</p></div>`
      + tabla([
        { titulo: 'Mensualidad', valor: (m) => `#${m.id_mensualidad}` },
        { titulo: 'Mes', valor: (m) => mes(m.anio, m.mes) },
        { titulo: 'Vence', valor: (m) => fecha(m.fecha_vencimiento) },
        { titulo: 'Valor', num: true, valor: (m) => dinero(m.valor_total) },
        { titulo: 'Estado', valor: (m) => insignia(m.estado_pago) },
      ], r.mensualidades);
    await cargarCatalogos();
  });
});

// ---------- 2 · Pagos (R2 + R5) ----------

const formPago = $('#form-pago');

async function cargarPendientes() {
  const id = formPago.id_representante.value;
  const contenedor = $('#pago-mensualidades');
  if (!id) {
    contenedor.innerHTML = '';
    actualizarTotal();
    return;
  }
  let mensualidades;
  try {
    ({ mensualidades } = await api(`/representantes/${id}/estado-cuenta`));
  } catch (err) {
    contenedor.innerHTML = htmlError(err);
    return;
  }
  const pendientes = mensualidades.filter((m) => centavos(m.saldo) > 0 && m.estado_pago !== 'anulada');
  contenedor.innerHTML = tabla([
    { titulo: '', valor: (m) => `<input type="checkbox" data-id="${m.id_mensualidad}" aria-label="Pagar saldo completo">` },
    { titulo: 'Alumno', valor: (m) => esc(m.alumno) },
    { titulo: 'Curso', valor: (m) => esc(m.curso) },
    { titulo: 'Mes', valor: (m) => mes(m.anio, m.mes) },
    { titulo: 'Vence', valor: (m) => fecha(m.fecha_vencimiento) },
    { titulo: 'Estado', valor: (m) => insignia(m.estado_pago) },
    { titulo: 'Saldo', num: true, valor: (m) => dinero(m.saldo) },
    {
      titulo: 'Aplicar',
      num: true,
      valor: (m) => `<input type="number" step="0.01" min="0" class="aplicar" data-id="${m.id_mensualidad}" data-saldo="${m.saldo}" placeholder="0.00">`,
    },
  ], pendientes, 'Este representante no tiene saldos pendientes.');
  actualizarTotal();
}

function marcarSiCubreSaldo(input) {
  const cubre = input.value !== '' && centavos(input.value) === centavos(input.dataset.saldo);
  $(`input[type=checkbox][data-id="${input.dataset.id}"]`, formPago).checked = cubre;
}

function actualizarTotal() {
  const total = $$('.aplicar', formPago).reduce((suma, input) => suma + centavos(input.value), 0);
  $('#pago-total').textContent = dinero(total / 100);
  return total;
}

function renderCamposComprobante() {
  const metodo = catalogos.metodos_pago.find((m) => String(m.id_metodo_pago) === formPago.id_metodo_pago.value);
  const fieldset = $('#campos-comprobante');
  fieldset.innerHTML = metodo?.campos_comprobante.length
    ? `<legend>Comprobante (${esc(metodo.nombre)}) → ${motor('MongoDB')}</legend>${camposComprobante(metodo.campos_comprobante)}`
    : '';
}

formPago.id_representante.addEventListener('change', () => {
  $('#resultado-pago').innerHTML = '';
  cargarPendientes();
});
formPago.id_metodo_pago.addEventListener('change', renderCamposComprobante);

$('#pago-mensualidades').addEventListener('input', (evento) => {
  const objetivo = evento.target;
  if (objetivo.type === 'checkbox') {
    const input = $(`.aplicar[data-id="${objetivo.dataset.id}"]`, formPago);
    input.value = objetivo.checked ? input.dataset.saldo : '';
  } else if (objetivo.classList.contains('aplicar')) {
    marcarSiCubreSaldo(objetivo);
  }
  actualizarTotal();
});

formPago.addEventListener('submit', (evento) => {
  evento.preventDefault();
  const contenedor = $('#resultado-pago');
  const desglose = $$('.aplicar', formPago)
    .filter((input) => centavos(input.value) > 0)
    .map((input) => ({ id_mensualidad: Number(input.dataset.id), valor: (centavos(input.value) / 100).toFixed(2) }));
  if (!desglose.length) {
    contenedor.innerHTML = htmlError(new Error('Indica cuánto aplicar al menos a una mensualidad.'));
    return;
  }
  enviar(formPago, contenedor, async () => {
    const resultado = await api('/pagos', {
      metodo: 'POST',
      cuerpo: {
        id_representante: formPago.id_representante.value,
        id_metodo_pago: formPago.id_metodo_pago.value,
        valor_total: (actualizarTotal() / 100).toFixed(2),
        desglose,
        comprobante: leerComprobante(formPago),
      },
    });
    renderPago(contenedor, resultado);
    renderCamposComprobante();
    await cargarPendientes();
  });
});

// Muestra lo que guardó cada motor para un pago. Si el comprobante falta,
// ofrece adjuntarlo (reintento hacia MongoDB).
function renderPago(contenedor, { postgresql: { pago, detalle }, mongodb: { comprobante }, error_comprobante }) {
  const metodo = catalogos.metodos_pago.find((m) => m.nombre === pago.metodo);
  const pendiente = pago.estado === 'pendiente_comprobante';

  contenedor.innerHTML = `
    ${error_comprobante ? `<div class="alerta aviso"><strong>El pago quedó guardado en ${motor('PostgreSQL')}, pero ${motor('MongoDB')} rechazó el comprobante</strong>
      <p>${esc(error_comprobante.error)}</p>
      ${htmlReglas(error_comprobante.reglas)}
      <p class="detalle">El pago queda <em>pendiente de comprobante</em> y se puede adjuntar abajo.</p></div>` : ''}
    <div class="dos-columnas">
      <article class="tarjeta">
        <header>${motor('PostgreSQL')}<h3>Pago #${pago.id_pago}</h3>${insignia(pago.estado)}</header>
        <dl>
          <dt>Representante</dt><dd>${esc(pago.representante)}</dd>
          <dt>Fecha</dt><dd>${fechaHora(pago.fecha_pago)}</dd>
          <dt>Método</dt><dd>${esc(pago.metodo)}</dd>
          <dt>Valor total</dt><dd>${dinero(pago.valor_total)}</dd>
          <dt>Registrado por</dt><dd>${esc(pago.registrado_por)}</dd>
          <dt>ref_comprobante</dt><dd><code>${esc(pago.ref_comprobante ?? 'null')}</code></dd>
        </dl>
        ${tabla([
          { titulo: 'Mensualidad', valor: (d) => `#${d.id_mensualidad} · ${esc(d.alumno)}` },
          { titulo: 'Curso / mes', valor: (d) => `${esc(d.curso)} · ${mes(d.anio, d.mes)}` },
          { titulo: 'Aplicado', num: true, valor: (d) => dinero(d.valor_aplicado) },
          { titulo: 'Saldo actual', num: true, valor: (d) => dinero(d.saldo_actual) },
        ], detalle)}
      </article>
      <article class="tarjeta">
        <header>${motor('MongoDB')}<h3>comprobantes_pago</h3></header>
        ${comprobante ? json(comprobante) : '<p class="vacio">Este pago aún no tiene comprobante.</p>'}
        ${pendiente && metodo ? `<form class="formulario form-reintento">
            ${camposComprobante(metodo.campos_comprobante)}
            <button type="submit">Adjuntar comprobante</button>
          </form><div class="resultado-reintento"></div>` : ''}
      </article>
    </div>`;

  const reintento = $('.form-reintento', contenedor);
  reintento?.addEventListener('submit', (evento) => {
    evento.preventDefault();
    enviar(reintento, $('.resultado-reintento', contenedor), async () => {
      const actualizado = await api(`/pagos/${pago.id_pago}/comprobante`, {
        metodo: 'POST',
        cuerpo: { comprobante: leerComprobante(reintento) },
      });
      renderPago(contenedor, actualizado);
    });
  });
}

$('#form-referencia').addEventListener('submit', (evento) => {
  evento.preventDefault();
  const formulario = evento.target;
  const contenedor = $('#resultado-referencia');
  enviar(formulario, contenedor, async () => {
    const { consulta, documentos } = await api(`/comprobantes?referencia=${encodeURIComponent(formulario.referencia.value.trim())}`);
    contenedor.innerHTML = `<article class="tarjeta">
      <header>${motor('MongoDB')}<h3>Consulta ejecutada</h3></header>
      <pre class="json">${esc(consulta)}</pre>
      ${documentos.length
        ? documentos.map(json).join('')
        : '<p class="vacio">No hay comprobantes de transferencia con esa referencia.</p>'}
    </article>`;
  });
});

// ---------- 3 · Estado de cuenta (R3) ----------

async function cargarCuenta() {
  const id = $('#cuenta-representante').value;
  const contenedor = $('#resultado-cuenta');
  $('#detalle-pago-cuenta').innerHTML = '';
  if (!id) {
    contenedor.innerHTML = '';
    return;
  }
  try {
    const { representante, resumen, alumnos, mensualidades, pagos } = await api(`/representantes/${id}/estado-cuenta`);
    contenedor.innerHTML = `
      <p class="nota">${esc(representante.nombres)} · C.I. ${esc(representante.cedula)} · ${esc(representante.telefono)} · ${esc(representante.correo)}</p>
      <div class="resumen">
        <div class="cifra"><span>Total cargado</span><strong>${dinero(resumen.total_cargado)}</strong></div>
        <div class="cifra"><span>Pagado</span><strong>${dinero(resumen.total_pagado)}</strong></div>
        <div class="cifra"><span>Saldo</span><strong>${dinero(resumen.saldo_total)}</strong></div>
        <div class="cifra"><span>Vencido</span><strong>${dinero(resumen.saldo_vencido)}</strong></div>
        <div class="cifra"><span>Situación</span><strong>${insignia(resumen.situacion)}</strong></div>
      </div>
      <h3>Por alumno</h3>
      ${tabla([
        { titulo: 'Alumno', valor: (a) => esc(a.alumno) },
        { titulo: 'Cargado', num: true, valor: (a) => dinero(a.total_cargado) },
        { titulo: 'Pagado', num: true, valor: (a) => dinero(a.total_pagado) },
        { titulo: 'Saldo', num: true, valor: (a) => dinero(a.saldo_total) },
        { titulo: 'Vencido', num: true, valor: (a) => dinero(a.saldo_vencido) },
        { titulo: 'Situación', valor: (a) => insignia(a.situacion) },
      ], alumnos)}
      <h3>Mensualidades</h3>
      ${tabla([
        { titulo: '#', valor: (m) => m.id_mensualidad },
        { titulo: 'Alumno', valor: (m) => esc(m.alumno) },
        { titulo: 'Curso', valor: (m) => esc(m.curso) },
        { titulo: 'Mes', valor: (m) => mes(m.anio, m.mes) },
        { titulo: 'Vence', valor: (m) => fecha(m.fecha_vencimiento) },
        { titulo: 'Valor', num: true, valor: (m) => dinero(m.valor_total) },
        { titulo: 'Pagado', num: true, valor: (m) => dinero(m.pagado) },
        { titulo: 'Saldo', num: true, valor: (m) => dinero(m.saldo) },
        { titulo: 'Estado', valor: (m) => `${insignia(m.estado_pago)}${m.dias_vencida ? ` <small>${m.dias_vencida} días</small>` : ''}` },
      ], mensualidades)}
      <h3>Pagos</h3>
      ${tabla([
        { titulo: '#', valor: (p) => p.id_pago },
        { titulo: 'Fecha', valor: (p) => fechaHora(p.fecha_pago) },
        { titulo: 'Método', valor: (p) => esc(p.metodo) },
        { titulo: 'Valor', num: true, valor: (p) => dinero(p.valor_total) },
        { titulo: 'Estado', valor: (p) => insignia(p.estado) },
        { titulo: '', valor: (p) => `<button type="button" class="enlace" data-ver-pago="${p.id_pago}">Ver en ambos motores</button>` },
      ], pagos, 'Sin pagos registrados.')}`;
  } catch (err) {
    contenedor.innerHTML = htmlError(err);
  }
}

$('#cuenta-representante').addEventListener('change', cargarCuenta);

$('#resultado-cuenta').addEventListener('click', async (evento) => {
  const id = evento.target.dataset.verPago;
  if (!id) return;
  const contenedor = $('#detalle-pago-cuenta');
  try {
    renderPago(contenedor, await api(`/pagos/${id}`));
    contenedor.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    contenedor.innerHTML = htmlError(err);
  }
});

// ---------- 4 · Mora (R4 + R6 + R7) ----------

const ETIQUETA_CANAL = { whatsapp: 'WhatsApp', correo: 'correo', sms: 'SMS' };

async function cargarMora() {
  try {
    const [morosos, notificaciones] = await Promise.all([api('/morosos'), api('/notificaciones')]);
    $('#tabla-morosos').innerHTML = tabla([
      { titulo: 'Representante', valor: (m) => esc(m.nombres) },
      { titulo: 'Deuda vencida', num: true, valor: (m) => dinero(m.deuda_vencida) },
      { titulo: 'Mensualidades', num: true, valor: (m) => m.mensualidades_vencidas },
      { titulo: 'Alumnos', num: true, valor: (m) => m.alumnos_en_mora },
      { titulo: 'Días de mora', num: true, valor: (m) => m.dias_mora },
      {
        titulo: '¿Ya notificada?',
        valor: (m) => (m.ultimo_aviso?.misma_mora ? 'sí, misma mora' : '<strong>no, deuda sin avisar</strong>'),
      },
      {
        titulo: `Último aviso ${motor('MongoDB')}`,
        valor: (m) => (m.ultimo_aviso
          ? `Nivel ${m.ultimo_aviso.nivel} · ${ETIQUETA_CANAL[m.ultimo_aviso.canal]} · ${fecha(m.ultimo_aviso.fecha_aviso)} ${insignia(m.ultimo_aviso.estado)}`
          : '<span class="vacio">sin avisos</span>'),
      },
    ], morosos, 'No hay representantes en mora.');

    $('#tabla-notificaciones').innerHTML = tabla([
      { titulo: 'Fecha del aviso', valor: (n) => fecha(n.fecha_aviso) },
      { titulo: 'Representante', valor: (n) => esc(n.representante.nombres) },
      { titulo: 'Nivel', num: true, valor: (n) => n.nivel },
      { titulo: 'Canal', valor: (n) => `${ETIQUETA_CANAL[n.canal]} · ${esc(n.destino)}` },
      { titulo: 'Deuda congelada', num: true, valor: (n) => dinero(n.deuda.total) },
      { titulo: 'Estado', valor: (n) => insignia(n.estado) },
      { titulo: 'Eventos', num: true, valor: (n) => n.seguimiento.length },
      { titulo: '', valor: (n) => `<button type="button" class="enlace" data-ver-notificacion="${n._id}">Ver documento</button>` },
    ], notificaciones, 'Aún no se ha notificado a nadie. Ejecuta el proceso de mora.');
    notificacionesCargadas = new Map(notificaciones.map((n) => [n._id, n]));
  } catch (err) {
    $('#tabla-morosos').innerHTML = htmlError(err);
  }
}

let notificacionesCargadas = new Map();

$('#form-mora').addEventListener('submit', (evento) => {
  evento.preventDefault();
  const formulario = evento.target;
  const contenedor = $('#resultado-mora');
  enviar(formulario, contenedor, async () => {
    const r = await api('/mora/ejecutar', { metodo: 'POST', cuerpo: { fecha: formulario.fecha.value } });
    contenedor.innerHTML = `<p class="nota">Ejecución del ${fecha(formulario.fecha.value)} · ${r.morosos_revisados} morosos revisados</p>`
      + tabla([
        { titulo: 'Representante', valor: (x) => esc(x.representante) },
        { titulo: 'Deuda vencida', num: true, valor: (x) => dinero(x.deuda_vencida) },
        { titulo: 'Resultado', valor: (x) => insignia(x.accion) },
        {
          titulo: 'Detalle',
          valor: (x) => (x.accion === 'notificado'
            ? `Aviso nivel ${x.nivel} por ${ETIQUETA_CANAL[x.canal]} a ${esc(x.destino)} (envío simulado)`
            : esc(x.motivo)),
        },
      ], r.resultados, 'No hay representantes en mora.');
    $('#detalle-notificacion').innerHTML = '';
    await cargarMora();
  });
});

const EVENTOS = ['entregado', 'leido', 'respuesta', 'compromiso_pago', 'nota', 'cerrado'];

function renderNotificacion(documento) {
  const contenedor = $('#detalle-notificacion');
  contenedor.innerHTML = `
    <div class="dos-columnas">
      <article class="tarjeta">
        <header>${motor('MongoDB')}<h3>Documento en notificaciones_mora</h3></header>
        ${json(documento)}
      </article>
      <article class="tarjeta">
        <header><h3>Agregar evento de seguimiento</h3></header>
        <p class="nota">Se agrega con <code>$push</code> al arreglo <code>seguimiento</code> del mismo documento:
          una operación atómica sobre un solo documento. La deuda congelada no cambia.</p>
        <form id="form-seguimiento" class="formulario apilado">
          <label>Evento <select name="evento">${EVENTOS.map((e) => `<option value="${e}">${e.replaceAll('_', ' ')}</option>`).join('')}</select></label>
          <label>Detalle <input name="detalle" placeholder="Ej.: se comprometió a pagar el viernes"></label>
          <label>Fecha de compromiso (opcional) <input type="date" name="fecha_compromiso"></label>
          <button type="submit">Registrar evento</button>
        </form>
        <div id="resultado-seguimiento"></div>
      </article>
    </div>`;

  const formulario = $('#form-seguimiento');
  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    enviar(formulario, $('#resultado-seguimiento'), async () => {
      const actualizado = await api(`/notificaciones/${documento._id}/seguimiento`, {
        metodo: 'POST',
        cuerpo: Object.fromEntries(new FormData(formulario)),
      });
      await cargarMora();
      renderNotificacion(actualizado);
    });
  });
}

$('#tabla-notificaciones').addEventListener('click', (evento) => {
  const id = evento.target.dataset.verNotificacion;
  if (!id) return;
  renderNotificacion(notificacionesCargadas.get(id));
  $('#detalle-notificacion').scrollIntoView({ behavior: 'smooth' });
});

// ---------- inicio ----------

$$('.pestanas button').forEach((boton) => boton.addEventListener('click', () => activar(boton.dataset.pestana)));
$('#form-matricula [name=fecha]').value = hoy();
$('#form-mora [name=fecha]').value = hoy();

api('/salud')
  .then(() => { $('#salud').textContent = 'PostgreSQL ✓ · MongoDB ✓'; })
  .catch(() => { $('#salud').textContent = 'Sin conexión con alguna base de datos'; });

await cargarCatalogos();
renderCamposComprobante();
activar(location.hash.slice(1) || 'matricula');
