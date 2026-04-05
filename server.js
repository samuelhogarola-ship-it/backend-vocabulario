const API_BASE_URL = 'https://aleman-backend.onrender.com';
const API_URL = `${API_BASE_URL}/api/vocabulario`;
const CURRENT_TEXT_URL = 'https://samuelcoachdealeman.com/blog/f/leseverstehen-b1-elektrische-busse-werden-eingef%C3%BChrt';
const STORAGE_KEY = 'samuel_aleman_progreso';
const PRACTICADAS_KEY = 'samuel_aleman_practicadas';
const COOLDOWN_MINUTES = 60;
const NIVELES_CONFIG = {
  a2b1: 'A2 - B1',
  b2: 'B2',
  c1: 'C1'
};
const TIPOS_CONFIG = {
  flashcards: 'Flashcards',
  test: 'Test',
  lueckentext: 'Lückentext',
  articulo: 'Artículo',
  ordenar: 'Ordenar frases'
};

let ejercicios = [];
let indice = 0;
let respuestas = [];
let seleccionActual = null;
let totalPalabras = 10;
let vocabularioCacheado = null;
let nivelSeleccionado = 'a2b1';
let actividadesSeleccionadas = [];
let palabrasDisponiblesNivel = [];

const $ = id => document.getElementById(id);
const setDisplay = (id, value) => { $(id).style.display = value; };
const show = (id, value = 'block') => setDisplay(id, value);
const hide = id => setDisplay(id, 'none');

function irAPantalla(screenId) {
  ['screen-content', 'screen-activity', 'screen-ejercicio', 'screen-resultado'].forEach(hide);
  show(screenId);
}

function snapshotRespuesta(ej, raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  return {
    pregunta: ej.pregunta,
    tuya: textoUsuario(ej, raw),
    correcta: textoCorrecta(ej),
    correcto: evaluar(ej, raw),
    _raw: Array.isArray(raw) ? [...raw] : raw,
    palabraBase: ej.palabraBase || ej.pregunta
  };
}

function guardarProgreso() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ejercicios,
      indice,
      respuestas,
      totalPalabras,
      nivelSeleccionado,
      actividadesSeleccionadas,
      ts: Date.now()
    }));
  } catch (e) {}
}

function cargarProgresoGuardado() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > 86400000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

function limpiarProgreso() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

function getPalabrasStats() {
  try {
    const raw = localStorage.getItem(PRACTICADAS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > 7 * 86400000) {
      localStorage.removeItem(PRACTICADAS_KEY);
      return {};
    }
    if (data.stats && typeof data.stats === 'object') return data.stats;
    if (Array.isArray(data.palabras)) {
      return Object.fromEntries(
        data.palabras.map(palabra => [
          palabra,
          { aciertos: 1, fallos: 0, completada: true, ultimaVezPorNivel: {} }
        ])
      );
    }
    return {};
  } catch (e) {
    return {};
  }
}

function getNivelProgressKey(nivel = nivelSeleccionado) {
  return normalizarNivelValor(mapNivelSeleccionado(nivel));
}

function getPalabrasUsadas() {
  const stats = getPalabrasStats();
  return Object.entries(stats)
    .filter(([, stat]) => stat && stat.completada)
    .map(([palabra]) => palabra);
}

function guardarPalabrasUsadas(nuevas) {
  try {
    const actuales = getPalabrasStats();
    const stats = { ...actuales };
    nuevas.filter(Boolean).forEach(palabra => {
      const previo = stats[palabra] || { aciertos: 0, fallos: 0, completada: false, ultimaVezPorNivel: {} };
      stats[palabra] = {
        aciertos: Math.max(previo.aciertos, 1),
        fallos: previo.fallos,
        completada: true,
        ultimaVezPorNivel: previo.ultimaVezPorNivel || {}
      };
    });
    localStorage.setItem(PRACTICADAS_KEY, JSON.stringify({
      stats,
      ts: Date.now()
    }));
  } catch (e) {}
}

function actualizarStatsPalabras(respuestasSesion) {
  try {
    const statsActuales = getPalabrasStats();
    const stats = { ...statsActuales };

    respuestasSesion.filter(Boolean).forEach(r => {
      const palabra = r.palabraBase;
      if (!palabra) return;
      const previo = stats[palabra] || { aciertos: 0, fallos: 0, completada: false, ultimaVezPorNivel: {} };
      const aciertos = previo.aciertos + (r.correcto ? 1 : 0);
      const fallos = previo.fallos + (r.correcto ? 0 : 1);
      stats[palabra] = {
        aciertos,
        fallos,
        completada: previo.completada || r.correcto,
        ultimaVezPorNivel: previo.ultimaVezPorNivel || {}
      };
    });

    localStorage.setItem(PRACTICADAS_KEY, JSON.stringify({
      stats,
      ts: Date.now()
    }));
  } catch (e) {}
}

function resetPalabrasUsadas() {
  try { localStorage.removeItem(PRACTICADAS_KEY); } catch (e) {}
}

function registrarAparicion(palabra, nivel = nivelSeleccionado) {
  try {
    if (!palabra) return;
    const statsActuales = getPalabrasStats();
    const previo = statsActuales[palabra] || { aciertos: 0, fallos: 0, completada: false, ultimaVezPorNivel: {} };
    const claveNivel = getNivelProgressKey(nivel);
    statsActuales[palabra] = {
      ...previo,
      ultimaVezPorNivel: {
        ...(previo.ultimaVezPorNivel || {}),
        [claveNivel]: Date.now()
      }
    };
    localStorage.setItem(PRACTICADAS_KEY, JSON.stringify({
      stats: statsActuales,
      ts: Date.now()
    }));
  } catch (e) {}
}

function registrarAparicionesSesion(palabras, nivel = nivelSeleccionado) {
  [...new Set((palabras || []).filter(Boolean))].forEach(palabra => registrarAparicion(palabra, nivel));
}

function cooldownSuperado(palabra, stats = getPalabrasStats(), nivel = nivelSeleccionado, minutosCooldown = COOLDOWN_MINUTES) {
  const claveNivel = getNivelProgressKey(nivel);
  const ultima = stats[palabra]?.ultimaVezPorNivel?.[claveNivel];
  if (!ultima) return true;
  return (Date.now() - ultima) > minutosCooldown * 60 * 1000;
}

function getUltimaVezPalabraNivel(palabra, stats = getPalabrasStats(), nivel = nivelSeleccionado) {
  const claveNivel = getNivelProgressKey(nivel);
  return stats[palabra]?.ultimaVezPorNivel?.[claveNivel] || 0;
}

function showError(msg) {
  const el = $('error-msg');
  el.textContent = msg;
  show('error-msg');
}

function getActividadesActivas() {
  return [...document.querySelectorAll('#practice-selector .config-chip.active')]
    .map(btn => btn.dataset.modo)
    .filter(Boolean);
}

function getNivelActivo() {
  return document.querySelector('#level-selector .config-chip.active')?.dataset.level || 'a2b1';
}

function getTiposEfectivos(actividades = actividadesSeleccionadas) {
  return Array.isArray(actividades) && actividades.length > 0 ? actividades : Object.keys(TIPOS_CONFIG);
}

function normalizarActividadGuardada(valor) {
  if (valor === 'traduccion') return 'flashcards';
  if (valor === 'completar') return 'lueckentext';
  return valor;
}

function normalizarActividadesGuardadas(valor) {
  if (Array.isArray(valor)) return valor.map(normalizarActividadGuardada);
  if (typeof valor === 'string') return [normalizarActividadGuardada(valor)];
  return [];
}

function actualizarNivelSeleccionado() {
  nivelSeleccionado = getNivelActivo();
}

function mapNivelSeleccionado(nivel = nivelSeleccionado) {
  return {
    a2b1: 'A2-B1',
    b2: 'B2',
    c1: 'C1'
  }[nivel] || 'A2-B1';
}

function normalizarNivelValor(valor) {
  return String(valor || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .replace(/[-–—]/g, '')
    .trim();
}

function actualizarHintActividad() {
  actividadesSeleccionadas = getActividadesActivas();
  const hint = $('practice-hint');

  if (actividadesSeleccionadas.length === 0) {
    hint.textContent = 'Si no eliges ninguna actividad, practicarás con todos los formatos.';
    return;
  }
  hint.textContent = `Practicarás con: ${actividadesSeleccionadas.map(tipo => TIPOS_CONFIG[tipo]).join(', ')}.`;
}

function activarActividadesEnPantalla(actividades) {
  const activas = Array.isArray(actividades) ? actividades : [];
  document.querySelectorAll('#practice-selector .config-chip').forEach(btn => {
    btn.classList.toggle('active', activas.includes(btn.dataset.modo));
  });
  actividadesSeleccionadas = activas;
  actualizarHintActividad();
}

function activarNivelEnPantalla(nivel) {
  document.querySelectorAll('#level-selector .config-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === nivel);
  });
  nivelSeleccionado = nivel || 'a2b1';
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sample(arr, n) {
  return shuffle(arr).slice(0, Math.min(n, arr.length));
}

function normalizar(txt) {
  return String(txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,!?;:¡¿]/g, '')
    .trim();
}

function extraerArticulo(aleman) {
  const m = String(aleman || '').match(/^(der|die|das)\s+/i);
  return m ? m[1].toLowerCase() : null;
}

function quitarArticulo(aleman) {
  return String(aleman || '').replace(/^(der|die|das)\s+/i, '').trim();
}

function escaparRegex(texto) {
  return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getStatsPalabra(palabraBase) {
  return getPalabrasStats()[palabraBase] || { aciertos: 0, fallos: 0, completada: false };
}

function getCategoriaBase(item) {
  return normalizar(item?.categoria || '');
}

function getCategoriaGramatical(item) {
  const categoria = getCategoriaBase(item);
  if (/(adjet|adjektiv)/.test(categoria)) return 'adjetivo';
  if (/(verb)/.test(categoria)) return 'verbo';
  if (/(sustant|substantiv|noun|nombre)/.test(categoria) || extraerArticulo(item?.aleman)) return 'sustantivo';
  if (/(adverb)/.test(categoria)) return 'adverbio';
  if (/(pron)/.test(categoria)) return 'pronombre';
  if (/(prep)/.test(categoria)) return 'preposicion';
  if (/(expres|locuc|frase|idiom)/.test(categoria) || esMultiPalabra(item?.aleman)) return 'expresion';
  return categoria || 'otro';
}

function esMultiPalabra(texto) {
  return String(texto || '').trim().includes(' ');
}

function puntuarDistractor(candidata, correcta, campo) {
  let score = 0;
  if (getCategoriaGramatical(candidata) === getCategoriaGramatical(correcta)) score += 8;
  if (getCategoriaBase(candidata) && getCategoriaBase(candidata) === getCategoriaBase(correcta)) score += 4;
  if (Boolean(extraerArticulo(candidata.aleman)) === Boolean(extraerArticulo(correcta.aleman))) score += 3;
  if (esMultiPalabra(candidata[campo]) === esMultiPalabra(correcta[campo])) score += 2;

  const diffCampo = Math.abs(String(candidata[campo] || '').length - String(correcta[campo] || '').length);
  const diffAleman = Math.abs(String(candidata.aleman || '').length - String(correcta.aleman || '').length);
  score += Math.max(0, 4 - Math.min(diffCampo, 4));
  score += Math.max(0, 3 - Math.min(diffAleman, 3));

  const candStats = getStatsPalabra(candidata.aleman);
  score += Math.min(candStats.fallos, 3);
  return score;
}

function filtrarPorNivel(lista, nivel = nivelSeleccionado) {
  const objetivo = normalizarNivelValor(mapNivelSeleccionado(nivel));
  return lista.filter(item => normalizarNivelValor(item.nivel || '') === objetivo);
}

function actualizarDisponibilidadNivel() {
  if (!vocabularioCacheado) return;

  palabrasDisponiblesNivel = filtrarPorNivel(vocabularioCacheado, nivelSeleccionado);
  const disponibles = palabrasDisponiblesNivel.length;
  const slider = $('slider-palabras');
  const status = $('level-status');
  const btn = $('btn-empezar');

  $('slider-max-label').textContent = disponibles;

  if (disponibles === 0) {
    slider.min = 0;
    slider.max = 0;
    slider.value = 0;
    slider.disabled = true;
    $('num-palabras-display').textContent = '0';
    status.textContent = 'Todavía no hay vocabulario disponible para este nivel.';
    status.className = 'level-status empty';
    btn.disabled = true;
    actualizarPanelProgresoSemanal();
    return;
  }

  slider.disabled = false;
  slider.min = Math.min(5, disponibles);
  slider.max = disponibles;
  slider.value = String(Math.min(Number(slider.value) || slider.min, disponibles));
  $('num-palabras-display').textContent = slider.value;
  status.textContent = `${disponibles} palabras disponibles para este nivel.`;
  status.className = 'level-status ready';
  btn.disabled = false;
  actualizarPanelProgresoSemanal();
}

async function cargarVocabulario() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.palabras)) throw new Error('Formato incorrecto');
  const lista = data.palabras
    .filter(p => p.aleman && p.espanol)
    .map(p => ({ ...p, frase: p.frase || '', nivel: p.nivel || '' }));

  return lista;
}

function getPoolDistractoresNivel() {
  return Array.isArray(palabrasDisponiblesNivel) && palabrasDisponiblesNivel.length > 0
    ? palabrasDisponiblesNivel
    : filtrarPorNivel(vocabularioCacheado || [], nivelSeleccionado);
}

function seleccionarDistractoresCompatibles(pool, correcta, campo, minimo = 2, ideal = 3) {
  const categoriaObjetivo = getCategoriaGramatical(correcta);
  const base = pool.filter(p =>
    normalizar(p[campo]) !== normalizar(correcta[campo]) &&
    normalizar(p.aleman) !== normalizar(correcta.aleman)
  );

  const mismaCategoriaNivel = base
    .filter(p => getCategoriaGramatical(p) === categoriaObjetivo)
    .map(p => ({ item: p, score: puntuarDistractor(p, correcta, campo) }))
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.item);

  if (mismaCategoriaNivel.length >= minimo) {
    return mismaCategoriaNivel.slice(0, Math.min(ideal, mismaCategoriaNivel.length));
  }

  const fallbackGlobal = (vocabularioCacheado || [])
    .filter(p =>
      normalizar(p[campo]) !== normalizar(correcta[campo]) &&
      normalizar(p.aleman) !== normalizar(correcta.aleman) &&
      getCategoriaGramatical(p) === categoriaObjetivo
    )
    .map(p => ({ item: p, score: puntuarDistractor(p, correcta, campo) }))
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.item);

  const combinados = [...new Map([...mismaCategoriaNivel, ...fallbackGlobal].map(item => [item.aleman, item])).values()];
  return combinados.slice(0, Math.min(ideal, combinados.length));
}

function crearTestOpciones(lista, correcta, campo) {
  const distractores = seleccionarDistractoresCompatibles(lista, correcta, campo, 2, 3).map(p => p[campo]);

  if (distractores.length < 2) return null;

  const opciones = shuffle([correcta[campo], ...distractores]);
  const letras = ['A', 'B', 'C', 'D'];
  const mapa = {};
  opciones.forEach((texto, i) => { mapa[letras[i]] = texto; });
  return { mapa, correcta: letras.find(l => mapa[l] === correcta[campo]) };
}

function generarEjercicios(lista, numPalabras, actividadesActivas = actividadesSeleccionadas) {
  const activos = getTiposEfectivos(actividadesActivas);
  const porTipo = Math.max(1, Math.ceil(numPalabras / activos.length));
  const baseLista = [...lista];
  const poolNivel = getPoolDistractoresNivel();

  const candidatosPorTipo = {
    flashcards: baseLista.map(item => ({
      tipo: 'flashcards',
      pregunta: item.aleman,
      preguntaSub: 'Piensa la traducción y marca si la sabías antes de verla',
      respuestaCorrecta: item.espanol,
      palabraBase: item.aleman
    })),
    test: baseLista.map(item => {
      const pack = crearTestOpciones(poolNivel, item, 'espanol');
      if (!pack) return null;
      return {
        tipo: 'test',
        pregunta: item.aleman,
        preguntaSub: 'Selecciona la traducción correcta',
        opcionA: pack.mapa.A,
        opcionB: pack.mapa.B,
        opcionC: pack.mapa.C,
        opcionD: pack.mapa.D,
        respuestaCorrecta: pack.correcta,
        palabraBase: item.aleman
      };
    }).filter(Boolean),
    lueckentext: baseLista.filter(p => p.frase).map(item => {
      const formasCandidatas = [item.aleman, quitarArticulo(item.aleman)]
        .map(txt => String(txt || '').trim())
        .filter(Boolean)
        .filter((txt, idx, arr) => arr.indexOf(txt) === idx)
        .sort((a, b) => b.length - a.length);

      let frase = item.frase;
      let encontrada = false;
      formasCandidatas.forEach(forma => {
        if (encontrada) return;
        const regex = new RegExp(`(^|\\b)${escaparRegex(forma)}(?=\\b)`, 'i');
        const reemplazada = frase.replace(regex, '$1___');
        if (reemplazada !== frase) {
          frase = reemplazada;
          encontrada = true;
        }
      });
      if (!encontrada) return null;

      const pack = crearTestOpciones(poolNivel, item, 'aleman');
      if (!pack) return null;

      return {
        tipo: 'lueckentext',
        pregunta: frase,
        preguntaSub: 'Elige la palabra que falta',
        opcionA: pack.mapa.A,
        opcionB: pack.mapa.B,
        opcionC: pack.mapa.C,
        opcionD: pack.mapa.D,
        respuestaCorrecta: pack.correcta,
        traducciones: Object.fromEntries(
          Object.values(pack.mapa).map(aleman => [
            aleman,
            lista.find(p => p.aleman === aleman)?.espanol || ''
          ])
        ),
        palabraBase: item.aleman
      };
    }).filter(Boolean),
    articulo: baseLista.filter(p => extraerArticulo(p.aleman)).map(item => {
      const art = extraerArticulo(item.aleman);
      const mapa = { A: 'der', B: 'die', C: 'das' };
      return {
        tipo: 'articulo',
        pregunta: quitarArticulo(item.aleman),
        preguntaSub: '¿Qué artículo lleva este sustantivo?',
        opcionA: 'der',
        opcionB: 'die',
        opcionC: 'das',
        respuestaCorrecta: Object.keys(mapa).find(k => mapa[k] === art),
        palabraBase: item.aleman
      };
    }),
    ordenar: baseLista
      .filter(item => String(item.frase || '').trim())
      .map(item => {
        const frase = String(item.frase || '').trim();
        return {
          tipo: 'ordenar',
          pregunta: 'Ordena la oración correctamente',
          preguntaSub: 'Clica las palabras en el orden correcto',
          palabras: shuffle(frase.split(' ')),
          respuestaCorrecta: frase,
          palabraBase: item.aleman
        };
      })
  };

  const ejs = [];
  activos.forEach(tipo => {
    ejs.push(...sample(candidatosPorTipo[tipo] || [], porTipo));
  });

  if (ejs.length < numPalabras) {
    const existentes = new Set(ejs.map(ej => `${ej.tipo}::${ej.palabraBase}`));
    const sobrantes = shuffle(
      activos.flatMap(tipo => (candidatosPorTipo[tipo] || []).filter(ej => !existentes.has(`${ej.tipo}::${ej.palabraBase}`)))
    );
    ejs.push(...sobrantes.slice(0, numPalabras - ejs.length));
  }

  return shuffle(ejs).slice(0, Math.min(numPalabras, ejs.length));
}

function renderEjercicio(ej, num, total, respuestaAnterior) {
  seleccionActual = Array.isArray(respuestaAnterior) ? [...respuestaAnterior] : respuestaAnterior ?? null;
  $('btn-siguiente').disabled = respuestaAnterior === null || respuestaAnterior === undefined || (Array.isArray(respuestaAnterior) ? respuestaAnterior.length === 0 : respuestaAnterior === '');
  $('btn-atras').disabled = num <= 1;
  $('prog-actual').textContent = num;
  $('prog-total').textContent = total;
  $('prog-fill').style.width = `${((num - 1) / total) * 100}%`;

  const labels = {
    flashcards: 'Flashcards',
    test: 'Test',
    lueckentext: 'Lückentext',
    articulo: 'Artículo',
    ordenar: 'Ordenar frases'
  };

  $('tipo-badge').textContent = labels[ej.tipo];
  $('pregunta-texto').textContent = ej.pregunta;
  $('pregunta-sub').textContent = ej.preguntaSub || '';
  $('opciones-wrap').innerHTML = '';
  hide('opciones-wrap');
  hide('flashcard-wrap');
  hide('input-wrap');
  hide('ordenar-wrap');

  if (ej.tipo === 'flashcards') {
    show('flashcard-wrap');
    const card = $('flashcard-card');
    $('flashcard-front').textContent = ej.pregunta;
    $('flashcard-back').textContent = ej.respuestaCorrecta;
    card.classList.toggle('revealed', Boolean(respuestaAnterior));
    seleccionActual = respuestaAnterior ?? null;
    $('btn-siguiente').disabled = !respuestaAnterior;
    $('btn-flashcard-si').onclick = () => {
      seleccionActual = 'si';
      card.classList.add('revealed');
      $('btn-siguiente').disabled = false;
    };
    $('btn-flashcard-no').onclick = () => {
      seleccionActual = 'no';
      card.classList.add('revealed');
      $('btn-siguiente').disabled = false;
    };
    return;
  }

  if (ej.tipo === 'ordenar') {
    show('ordenar-wrap');
    const banco = $('banco-palabras');
    const construccion = $('orden-construccion');
    banco.innerHTML = '';
    construccion.innerHTML = '';
    seleccionActual = [];

    const addWord = (word, sourceChip) => {
      sourceChip.classList.add('usada');
      seleccionActual.push(word);
      const c2 = document.createElement('span');
      c2.className = 'palabra-chip';
      c2.textContent = word;
      c2.onclick = () => {
        const idx = seleccionActual.findIndex((w, i) => w === word && i === [...construccion.children].indexOf(c2));
        if (idx > -1) {
          seleccionActual.splice(idx, 1);
        } else {
          const fallback = seleccionActual.lastIndexOf(word);
          if (fallback > -1) seleccionActual.splice(fallback, 1);
        }
        sourceChip.classList.remove('usada');
        c2.remove();
        $('btn-siguiente').disabled = seleccionActual.length === 0;
      };
      construccion.appendChild(c2);
      $('btn-siguiente').disabled = false;
    };

    ej.palabras.forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'palabra-chip';
      chip.textContent = p;
      chip.onclick = () => {
        if (chip.classList.contains('usada')) return;
        addWord(p, chip);
      };
      banco.appendChild(chip);
    });

    if (Array.isArray(respuestaAnterior) && respuestaAnterior.length > 0) {
      respuestaAnterior.forEach(p => {
        const chip = [...banco.children].find(c => c.textContent === p && !c.classList.contains('usada'));
        if (chip) chip.click();
      });
    }

    return;
  }

  const opciones = [
    { l: 'A', t: ej.opcionA },
    { l: 'B', t: ej.opcionB },
    { l: 'C', t: ej.opcionC }
  ];
  if (ej.opcionD) opciones.push({ l: 'D', t: ej.opcionD });

  show('opciones-wrap', 'grid');
  $('opciones-wrap').className = ej.tipo === 'articulo' ? 'opciones tres' : 'opciones';

  opciones.forEach(op => {
    const btn = document.createElement('button');
    btn.className = 'opcion-btn';
    const contenido = document.createElement('div');
    contenido.className = 'opcion-contenido';
    const texto = document.createElement('span');
    texto.textContent = op.t;
    contenido.appendChild(texto);

    if (ej.tipo === 'lueckentext' && ej.traducciones) {
      const ayuda = document.createElement('span');
      ayuda.textContent = '💬';
      ayuda.className = 'ayuda-icono';
      const tooltip = document.createElement('span');
      tooltip.className = 'tooltip-traduccion';
      tooltip.textContent = ej.traducciones[op.t] || '';
      ayuda.onclick = e => {
        e.stopPropagation();
        tooltip.style.display = tooltip.style.display === 'none' ? 'inline' : 'none';
      };
      contenido.appendChild(ayuda);
      contenido.appendChild(tooltip);
    }

    btn.appendChild(contenido);
    if (respuestaAnterior === op.l) btn.classList.add('seleccionada');

    btn.onclick = e => {
      if (e.target.classList.contains('ayuda-icono')) return;
      document.querySelectorAll('.opcion-btn').forEach(b => b.classList.remove('seleccionada'));
      btn.classList.add('seleccionada');
      seleccionActual = op.l;
      $('btn-siguiente').disabled = false;
    };

    $('opciones-wrap').appendChild(btn);
  });
}

function evaluar(ej, respuesta) {
  if (ej.tipo === 'flashcards') return String(respuesta || '').toLowerCase() === 'si';
  if (ej.tipo === 'ordenar') return normalizar((respuesta || []).join(' ')) === normalizar(ej.respuestaCorrecta);
  return String(respuesta || '').toUpperCase() === String(ej.respuestaCorrecta || '').toUpperCase();
}

function textoUsuario(ej, respuesta) {
  if (ej.tipo === 'flashcards') return String(respuesta || '').toLowerCase() === 'si' ? 'Sí' : 'No la sé';
  if (ej.tipo === 'ordenar') return (respuesta || []).join(' ') || '—';
  return { A: ej.opcionA, B: ej.opcionB, C: ej.opcionC, D: ej.opcionD }[respuesta] || '—';
}

function textoCorrecta(ej) {
  if (ej.tipo === 'flashcards') return ej.respuestaCorrecta;
  if (ej.tipo === 'ordenar') return ej.respuestaCorrecta;
  return { A: ej.opcionA, B: ej.opcionB, C: ej.opcionC, D: ej.opcionD }[ej.respuestaCorrecta] || ej.respuestaCorrecta;
}

function actualizarBloqueContinuar() {
  const btn = $('btn-continuar');
  if (!vocabularioCacheado) {
    hide('btn-continuar');
    return;
  }
  const usadas = getPalabrasUsadas();
  const restantes = filtrarPorNivel(vocabularioCacheado, nivelSeleccionado).filter(p => !usadas.includes(p.aleman));
  const numRestantes = restantes.length;

  if (numRestantes > 0) {
    btn.textContent = `¿Seguir practicando? Te quedan ${numRestantes} palabras nuevas`;
    btn.onclick = () => {
      limpiarProgreso();
      hide('screen-resultado');
      const num = Number($('slider-palabras').value);
      const disponiblesNivel = filtrarPorNivel(vocabularioCacheado, nivelSeleccionado);
      const pool = seleccionarPalabrasPriorizadas(disponiblesNivel, num);
      ejercicios = generarEjercicios(pool, num, actividadesSeleccionadas);
      registrarAparicionesSesion(ejercicios.map(ej => ej.palabraBase), nivelSeleccionado);
      indice = 0;
      respuestas = Array(ejercicios.length).fill(null);
      show('screen-ejercicio');
      renderEjercicio(ejercicios[0], 1, ejercicios.length, null);
      guardarProgreso();
    };
    show('btn-continuar');
    $('btn-reiniciar').textContent = 'Volver al menú principal';
  } else {
    hide('btn-continuar');
    $('btn-reiniciar').textContent = 'Volver a intentarlo';
  }
}

function mostrarResultado() {
  limpiarProgreso();
  hide('screen-ejercicio');
  show('screen-resultado');

  const contestadas = respuestas.filter(Boolean);
  actualizarStatsPalabras(contestadas);

  const correctas = contestadas.filter(r => r.correcto).length;
  const total = contestadas.length;
  const pct = total > 0 ? Math.round((correctas / total) * 100) : 0;

  $('punt-grande').textContent = `${correctas}/${total}`;
  $('punt-label').textContent =
    pct >= 80
      ? '¡Sehr gut! Sigue así 🎉'
      : pct >= 50
        ? 'Gut gemacht, sigue practicando 💪'
        : 'Übung macht den Meister — ¡inténtalo de nuevo!';

  const lista = $('resumen-lista');
  lista.innerHTML = '';
  contestadas.forEach(r => {
    const div = document.createElement('div');
    div.className = 'resumen-item';
    div.innerHTML = `
      <span class="resumen-icon">${r.correcto ? '✓' : '✗'}</span>
      <div>
        <div class="resumen-pregunta">${r.pregunta}</div>
        ${r.correcto
          ? `<div class="resumen-correcta">${r.tuya}</div>`
          : `<div class="resumen-tuya">Tu respuesta: ${r.tuya}</div><div class="resumen-correcta">Correcta: ${r.correcta}</div>`
        }
      </div>`;
    lista.appendChild(div);
  });

  actualizarPanelProgresoSemanal();
  actualizarBloqueContinuar();
}

function mostrarModalTerminar() {
  const hechos = respuestas.filter(Boolean).length;
  const quedan = ejercicios.length - hechos;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-terminar';
  overlay.innerHTML = `
    <div class="modal-box">
      <span class="modal-emoji">🏳️</span>
      <h3>¿Terminar el test?</h3>
      <p>Llevas <strong>${hechos} ejercicio${hechos !== 1 ? 's' : ''}</strong> completado${hechos !== 1 ? 's' : ''}. Aún te quedan <strong>${quedan}</strong> por hacer.</p>
      <div class="modal-btns">
        <button class="btn-main-solo" id="modal-btn-terminar">Sí, terminar y ver resultados</button>
        <button class="btn-modal-secondary" id="modal-btn-continuar">Seguir el test</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  $('modal-btn-terminar').onclick = () => {
    overlay.remove();
    mostrarResultado();
  };
  $('modal-btn-continuar').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

function actualizarStatsInicio() {
  actualizarPanelProgresoSemanal();
}

function getResumenProgresoNivel() {
  const disponibles = vocabularioCacheado ? filtrarPorNivel(vocabularioCacheado, nivelSeleccionado) : [];
  const usadasSet = new Set(getPalabrasUsadas());
  const practicadas = disponibles.filter(p => usadasSet.has(p.aleman)).length;
  const pendientes = Math.max(disponibles.length - practicadas, 0);
  const porcentaje = disponibles.length > 0 ? Math.round((practicadas / disponibles.length) * 100) : 0;
  return { disponibles: disponibles.length, practicadas, pendientes, porcentaje };
}

function actualizarPanelProgresoSemanal() {
  const resumen = getResumenProgresoNivel();
  const nivelTexto = mapNivelSeleccionado(nivelSeleccionado);
  $('weekly-progress-title').textContent = `Progreso ${nivelTexto}`;
  $('weekly-progress-pct').textContent = `${resumen.porcentaje}% completado`;
  $('weekly-progress-fill').style.width = `${resumen.porcentaje}%`;
  $('weekly-progress-main').textContent = `${resumen.practicadas} / ${resumen.disponibles} palabras practicadas`;
  $('weekly-progress-sub').textContent = `${resumen.disponibles} palabras en este nivel`;
  $('btn-reset-progress').disabled = resumen.practicadas === 0;
}

function seleccionarSinRepetir(todasLasPalabras, nivel, n) {
  const stats = getPalabrasStats();
  const unseen = shuffle(
    todasLasPalabras.filter(p => !stats[p.aleman] || (stats[p.aleman].aciertos + stats[p.aleman].fallos) === 0)
  );

  const vistasFueraCooldown = [...todasLasPalabras]
    .filter(p => {
      const stat = stats[p.aleman];
      return stat && !unseen.find(x => x.aleman === p.aleman) && cooldownSuperado(p.aleman, stats, nivel);
    })
    .sort((a, b) => {
      const sa = stats[a.aleman] || { fallos: 0, aciertos: 0 };
      const sb = stats[b.aleman] || { fallos: 0, aciertos: 0 };
      const diffFallos = (sb.fallos || 0) - (sa.fallos || 0);
      if (diffFallos !== 0) return diffFallos;

      const diffUltimaVez = getUltimaVezPalabraNivel(a.aleman, stats, nivel) - getUltimaVezPalabraNivel(b.aleman, stats, nivel);
      if (diffUltimaVez !== 0) return diffUltimaVez;

      return Math.random() - 0.5;
    });

  const resto = shuffle(
    todasLasPalabras.filter(p =>
      !unseen.find(x => x.aleman === p.aleman) &&
      !vistasFueraCooldown.find(x => x.aleman === p.aleman)
    )
  );

  return [...unseen, ...vistasFueraCooldown, ...resto].slice(0, Math.min(n, todasLasPalabras.length));
}

function seleccionarPalabrasPriorizadas(lista, cantidad) {
  return seleccionarSinRepetir(lista, nivelSeleccionado, cantidad);
}

async function iniciar(continuar = false) {
  hide('screen-activity');
  hide('error-msg');
  show('loading');

  if (!continuar) {
    try {
      const palabras = vocabularioCacheado || await cargarVocabulario();
      vocabularioCacheado = palabras;
      actualizarNivelSeleccionado();
      actualizarDisponibilidadNivel();
      totalPalabras = Number($('slider-palabras').value);

      const filtradasPorNivel = palabrasDisponiblesNivel;
      const pool = seleccionarPalabrasPriorizadas(filtradasPorNivel, totalPalabras);

      ejercicios = generarEjercicios(pool, totalPalabras, actividadesSeleccionadas);
      registrarAparicionesSesion(ejercicios.map(ej => ej.palabraBase), nivelSeleccionado);
      indice = 0;
      respuestas = Array(ejercicios.length).fill(null);
    } catch (e) {
      hide('loading');
      show('screen-activity');
      showError(`Error al cargar el vocabulario. ${e.message}`);
      return;
    }
  }

  hide('loading');
  irAPantalla('screen-ejercicio');
  renderEjercicio(ejercicios[indice], indice + 1, ejercicios.length, respuestas[indice]?._raw ?? null);
  guardarProgreso();
}

async function precargar() {
  try {
    vocabularioCacheado = await cargarVocabulario();
    actualizarDisponibilidadNivel();
    actualizarStatsInicio();
  } catch (e) {}
}

$('slider-palabras').oninput = e => {
  $('num-palabras-display').textContent = e.target.value;
};

$('btn-empezar').onclick = () => iniciar(false);

$('btn-siguiente').onclick = () => {
  respuestas[indice] = snapshotRespuesta(ejercicios[indice], seleccionActual);
  const esUltimo = indice === ejercicios.length - 1;

  if (esUltimo) {
    mostrarResultado();
  } else {
    indice += 1;
    renderEjercicio(ejercicios[indice], indice + 1, ejercicios.length, respuestas[indice]?._raw ?? null);
    guardarProgreso();
  }
};

$('btn-atras').onclick = () => {
  if (indice <= 0) return;

  const actual = snapshotRespuesta(ejercicios[indice], seleccionActual);
  respuestas[indice] = actual;
  indice -= 1;
  renderEjercicio(ejercicios[indice], indice + 1, ejercicios.length, respuestas[indice]?._raw ?? null);
  guardarProgreso();
};

$('btn-terminar').onclick = () => mostrarModalTerminar();

$('btn-reiniciar').onclick = () => {
  limpiarProgreso();
  hide('screen-resultado');
  irAPantalla('screen-activity');
  actualizarStatsInicio();
};

$('btn-reset-progress').onclick = () => {
  resetPalabrasUsadas();
  limpiarProgreso();
  actualizarStatsInicio();
  actualizarDisponibilidadNivel();
};

document.querySelectorAll('#practice-selector .config-chip').forEach(btn => {
  btn.onclick = () => {
    btn.classList.toggle('active');
    actualizarHintActividad();
  };
});

document.querySelectorAll('#level-selector .config-chip').forEach(btn => {
  btn.onclick = () => {
    activarNivelEnPantalla(btn.dataset.level);
    actualizarDisponibilidadNivel();
  };
});

$('btn-volver-landing').onclick = () => {
  hide('main-app');
  hide('app-header');
  show('screen-landing', 'flex');
};

$('btn-ir-actividad').onclick = () => {
  irAPantalla('screen-activity');
};

$('btn-volver-contenido').onclick = () => {
  irAPantalla('screen-content');
};

$('btn-open-text').href = CURRENT_TEXT_URL;

$('btn-entrar').onclick = () => {
  hide('screen-landing');
  show('main-app', 'flex');
  show('app-header');
  irAPantalla('screen-content');
  precargar();
  hide('progreso-guardado-banner');

  const guardado = cargarProgresoGuardado();
  if (guardado && guardado.ejercicios && guardado.indice < guardado.ejercicios.length) {
    const banner = $('progreso-guardado-banner');
    $('prog-guardado-txt').textContent = `Ejercicio ${guardado.indice + 1} de ${guardado.ejercicios.length}`;
    show('progreso-guardado-banner');
    banner.onclick = () => {
      ejercicios = guardado.ejercicios;
      indice = guardado.indice;
      respuestas = guardado.respuestas;
      totalPalabras = guardado.totalPalabras;
      nivelSeleccionado = typeof guardado.nivelSeleccionado === 'string' ? guardado.nivelSeleccionado : 'a2b1';
      actividadesSeleccionadas = normalizarActividadesGuardadas(
        guardado.actividadesSeleccionadas ?? guardado.actividadSeleccionada
      );
      activarNivelEnPantalla(nivelSeleccionado);
      actualizarDisponibilidadNivel();
      activarActividadesEnPantalla(actividadesSeleccionadas);
      hide('progreso-guardado-banner');
      irAPantalla('screen-ejercicio');
      renderEjercicio(ejercicios[indice], indice + 1, ejercicios.length, respuestas[indice]?._raw ?? null);
    };
  }
};

activarNivelEnPantalla('a2b1');
activarActividadesEnPantalla([]);
