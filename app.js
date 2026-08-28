// ---------- Dados em memória ----------
let data = null;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function defaultData() {
  return {
    version: 1,
    categories: [
      { id: uid(), nome: 'Moradia', cor: '#d4a95e' },
      { id: uid(), nome: 'Alimentação', cor: '#34d399' },
      { id: uid(), nome: 'Transporte', cor: '#60a5fa' },
      { id: uid(), nome: 'Saúde', cor: '#f472b6' },
      { id: uid(), nome: 'Lazer', cor: '#a78bfa' },
      { id: uid(), nome: 'Educação', cor: '#38bdf8' },
      { id: uid(), nome: 'Assinaturas', cor: '#fb923c' },
      { id: uid(), nome: 'Salário', cor: '#4ade80' },
      { id: uid(), nome: 'Outros', cor: '#9ca3af' },
    ],
    pessoas: [
      { id: uid(), nome: 'Eu', cor: '#d4a95e' },
      { id: uid(), nome: 'Esposa', cor: '#a78bfa' },
    ],
    transactions: [],
    recurring: [],
  };
}

function setSaveStatus(text) {
  const el = document.getElementById('save-status');
  if (el) el.textContent = text;
}

// ---------- Login com Google + Google Drive (appDataFolder) ----------
const DRIVE_FILE_NAME = 'dados-financeiros.json';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

let tokenClient = null;
let accessToken = null;
let driveFileId = localStorage.getItem('driveFileId') || null;

const TOKEN_CACHE_KEY = 'gAuthToken';
function saveTokenCache(resp) {
  const expiresAt = Date.now() + (Number(resp.expires_in) || 0) * 1000;
  localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ access_token: resp.access_token, expires_at: expiresAt }));
}
function loadTokenCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(TOKEN_CACHE_KEY));
    if (!cached || !cached.access_token || !cached.expires_at) return null;
    if (cached.expires_at - 60000 <= Date.now()) return null;
    return cached;
  } catch (e) {
    return null;
  }
}
function clearTokenCache() {
  localStorage.removeItem(TOKEN_CACHE_KEY);
}

function onGisReady() {
  if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.startsWith('COLE_AQUI')) {
    showLoginScreen();
    showLoginError('Falta configurar o Client ID em config.js (veja SETUP.txt).');
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    callback: () => {},
  });

  const cached = loadTokenCache();
  if (cached) {
    accessToken = cached.access_token;
    bootstrapData();
  } else {
    trySilentLogin();
  }
}

function waitForGoogleScript(attemptsLeft) {
  if (window.google && google.accounts && google.accounts.oauth2) {
    onGisReady();
    return;
  }
  if (attemptsLeft <= 0) {
    showLoginScreen();
    showLoginError('Não foi possível carregar o login do Google. Verifique sua internet e recarregue a página.');
    return;
  }
  setTimeout(() => waitForGoogleScript(attemptsLeft - 1), 100);
}

function requestToken(promptValue) {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) {
        reject(resp);
        return;
      }
      accessToken = resp.access_token;
      saveTokenCache(resp);
      resolve(resp);
    };
    tokenClient.requestAccessToken({ prompt: promptValue });
  });
}

function trySilentLogin() {
  document.getElementById('loading-screen').classList.remove('hidden');
  requestToken('')
    .then(() => bootstrapData())
    .catch(() => {
      document.getElementById('loading-screen').classList.add('hidden');
      showLoginScreen();
    });
}

function showLoginScreen() {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

document.getElementById('btn-login').addEventListener('click', () => {
  if (!tokenClient) return;
  document.getElementById('login-error').classList.add('hidden');
  requestToken('consent')
    .then(() => bootstrapData())
    .catch(() => showLoginError('Não foi possível entrar. Tente de novo.'));
});

document.getElementById('btn-logout').addEventListener('click', () => {
  if (accessToken && window.google) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  clearTokenCache();
  document.getElementById('app').classList.add('hidden');
  showLoginScreen();
});

async function driveFetch(url, options = {}) {
  const doFetch = () => fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` } });
  let res = await doFetch();
  if (res.status === 401) {
    await requestToken('');
    res = await doFetch();
  }
  return res;
}

async function findDriveFile() {
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const res = await driveFetch(`${DRIVE_API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name)`);
  const json = await res.json();
  return json.files && json.files[0] ? json.files[0].id : null;
}

async function createDriveFile() {
  const metadata = { name: DRIVE_FILE_NAME, parents: ['appDataFolder'] };
  const boundary = 'financeiro_boundary';
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(defaultData())}\r\n` +
    `--${boundary}--`;
  const res = await driveFetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const json = await res.json();
  return json.id;
}

async function readDriveFile(fileId) {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  return res.json();
}

async function writeDriveFile(fileId, obj) {
  await driveFetch(`${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });
}

async function bootstrapData() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('loading-screen').classList.remove('hidden');
  try {
    if (!driveFileId) driveFileId = await findDriveFile();
    if (!driveFileId) driveFileId = await createDriveFile();
    localStorage.setItem('driveFileId', driveFileId);
    const loaded = await readDriveFile(driveFileId);
    data = Object.assign(defaultData(), loaded);
    if (!Array.isArray(data.categories) || data.categories.length === 0) data.categories = defaultData().categories;
    if (!Array.isArray(data.transactions)) data.transactions = [];
    if (!Array.isArray(data.recurring)) data.recurring = [];
    if (!Array.isArray(data.pessoas) || data.pessoas.length === 0) data.pessoas = defaultData().pessoas;
  } catch (e) {
    document.getElementById('loading-screen').classList.add('hidden');
    showLoginScreen();
    showLoginError('Não foi possível carregar seus dados. Tente novamente.');
    return;
  }
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  renderAll();
}

let saveTimer = null;
function scheduleSave() {
  setSaveStatus('Salvando…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await writeDriveFile(driveFileId, data);
      setSaveStatus('Salvo');
    } catch (e) {
      setSaveStatus('Erro ao salvar — verifique sua internet');
    }
  }, 400);
}

document.getElementById('btn-backup').addEventListener('click', () => {
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-financeiro-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- Estado de mês corrente / filtro de pessoa ----------
let currentDate = new Date();
currentDate.setDate(1);
let currentPessoaFilter = 'todos';

function monthKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function monthLabel(d) {
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function formatCurrency(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}
function formatDateBR(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// ---------- Ícones de categoria ----------
const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICON_LIBRARY = {
  casa: `<svg ${ICON_ATTRS}><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>`,
  cesta: `<svg ${ICON_ATTRS}><path d="M4 9h16l-1.5 10a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></svg>`,
  carro: `<svg ${ICON_ATTRS}><path d="M3 13l1.5-5A2 2 0 0 1 6.4 6.5h11.2A2 2 0 0 1 19.5 8l1.5 5"/><rect x="2.5" y="13" width="19" height="5" rx="1.5"/><circle cx="7" cy="18.5" r="1.5"/><circle cx="17" cy="18.5" r="1.5"/></svg>`,
  coracao: `<svg ${ICON_ATTRS}><path d="M12 20s-7-4.5-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 5c-2.3 4.5-9.3 9-9.3 9Z"/><path d="M8 12h2l1.5 3L13 9l1.5 3H16"/></svg>`,
  controle: `<svg ${ICON_ATTRS}><rect x="2" y="7" width="20" height="12" rx="4"/><circle cx="8" cy="13" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.2" cy="14.2" r="1.2" fill="currentColor" stroke="none"/></svg>`,
  livro: `<svg ${ICON_ATTRS}><path d="M12 6.5c-1.8-1.3-4.2-2-7-2v13c2.8 0 5.2.7 7 2 1.8-1.3 4.2-2 7-2v-13c-2.8 0-5.2.7-7 2Z"/><path d="M12 6.5v13"/></svg>`,
  repetir: `<svg ${ICON_ATTRS}><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16"/><path d="M4 20v-4h4"/></svg>`,
  carteira: `<svg ${ICON_ATTRS}><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14" r="1.3" fill="currentColor" stroke="none"/></svg>`,
  pontos: `<svg ${ICON_ATTRS}><circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>`,
  etiqueta: `<svg ${ICON_ATTRS}><path d="M11.5 3.5 20 12l-8 8-8.5-8.5V4.5a1 1 0 0 1 1-1H11.5Z"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/></svg>`,
  aviao: `<svg ${ICON_ATTRS}><path d="M3 11l18-8-8 18-2-8-8-2Z"/></svg>`,
  mala: `<svg ${ICON_ATTRS}><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/></svg>`,
  presente: `<svg ${ICON_ATTRS}><rect x="4" y="8.5" width="16" height="11.5" rx="1.5"/><path d="M4 12.5h16"/><path d="M12 8.5v11.5"/><path d="M9 8.5c0-2 1.3-3.5 3-3.5s3 1.5 3 3.5"/></svg>`,
  pata: `<svg ${ICON_ATTRS}><circle cx="7" cy="9" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="6.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="17" cy="9" r="1.6" fill="currentColor" stroke="none"/><path d="M12 12c-3 0-5 2.2-5 4.5S8.5 20 12 20s5-1.2 5-3.5S15 12 12 12Z"/></svg>`,
  celular: `<svg ${ICON_ATTRS}><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 18.5h3"/></svg>`,
  camiseta: `<svg ${ICON_ATTRS}><path d="M8 4 3 7l2 3 2-1v11h10V9l2 1 2-3-5-3-2 2h-2Z"/></svg>`,
  grafico: `<svg ${ICON_ATTRS}><path d="M3 17l6-6 4 4 8-8"/><path d="M15 6h6v6"/></svg>`,
  escudo: `<svg ${ICON_ATTRS}><path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3Z"/></svg>`,
  cartao: `<svg ${ICON_ATTRS}><rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 10h19"/><path d="M6 15h4"/></svg>`,
  wifi: `<svg ${ICON_ATTRS}><path d="M4 9a13 13 0 0 1 16 0"/><path d="M7.5 12.5a8 8 0 0 1 9 0"/><path d="M11 16a3 3 0 0 1 2 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none"/></svg>`,
  ferramenta: `<svg ${ICON_ATTRS}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6Z"/></svg>`,
  pessoa: `<svg ${ICON_ATTRS}><circle cx="12" cy="7.5" r="3.5"/><path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/></svg>`,
  documento: `<svg ${ICON_ATTRS}><path d="M7 3h7l4 4v14H7Z"/><path d="M14 3v4h4"/><path d="M9.5 12h5"/><path d="M9.5 15.5h5"/></svg>`,
  xicara: `<svg ${ICON_ATTRS}><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M17 9.5h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 4.5c0 1-1 1-1 2M12 4.5c0 1-1 1-1 2"/></svg>`,
  combustivel: `<svg ${ICON_ATTRS}><path d="M4 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15"/><path d="M4 21h10"/><path d="M14 10h2l3 3v5a1.5 1.5 0 0 1-3 0v-1.5a1 1 0 0 0-1-1H14"/><path d="M7 6.5h5"/></svg>`,
  academia: `<svg ${ICON_ATTRS}><path d="M4 9v6"/><path d="M2.5 10.5v3"/><path d="M20 9v6"/><path d="M21.5 10.5v3"/><path d="M7 12h10"/><path d="M7 9v6"/><path d="M17 9v6"/></svg>`,
  moto: `<svg ${ICON_ATTRS}><circle cx="5.5" cy="17.5" r="2.7"/><circle cx="18" cy="17.5" r="2.7"/><path d="M8 17.5h7l2.5-4.5-2-3.5h-3.5"/><path d="M9.5 17.5l1.8-5.5h3"/><path d="M13.5 8.5h3"/></svg>`,
  compasso: `<svg ${ICON_ATTRS}><circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><path d="M12 6.5 7.5 19"/><path d="M12 6.5 16.5 19"/><path d="M9.7 13h1.8"/></svg>`,
};
const ICON_LABELS = {
  casa: 'Casa', cesta: 'Mercado', carro: 'Carro', coracao: 'Saúde', controle: 'Jogos',
  livro: 'Educação', repetir: 'Assinatura', carteira: 'Dinheiro', pontos: 'Outros', etiqueta: 'Geral',
  aviao: 'Viagem', mala: 'Trabalho', presente: 'Presente', pata: 'Pet', celular: 'Celular',
  camiseta: 'Roupas', grafico: 'Investimentos', escudo: 'Seguro', cartao: 'Cartão', wifi: 'Internet',
  ferramenta: 'Manutenção', pessoa: 'Família', documento: 'Documentos', xicara: 'Café', combustivel: 'Combustível',
  academia: 'Academia', moto: 'Moto/Entrega', compasso: 'Arquitetura',
};
const DEFAULT_ICON_BY_NAME = {
  moradia: 'casa', alimentacao: 'cesta', transporte: 'carro', saude: 'coracao',
  lazer: 'controle', educacao: 'livro', assinaturas: 'repetir', salario: 'carteira', outros: 'pontos',
};
const GENERIC_ICON_KEY = 'etiqueta';
const GENERIC_ICON = ICON_LIBRARY[GENERIC_ICON_KEY];

// ---------- Ícones de ação (editar / excluir / duplicar) ----------
const TRASH_ICON = `<svg ${ICON_ATTRS}><path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
const DUPLICATE_ICON = `<svg ${ICON_ATTRS}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`;
function rowActionIcon(role, icon, id, title) {
  const idAttr = id ? ` data-id="${id}"` : '';
  return `<span class="row-action-icon" data-role="${role}"${idAttr} title="${title}">${icon}</span>`;
}
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}
function categoryIcon(cat) {
  if (!cat) return GENERIC_ICON;
  if (cat.icone) {
    if (ICON_LIBRARY[cat.icone]) return ICON_LIBRARY[cat.icone];
    if (/^\s*<svg[\s>]/i.test(cat.icone)) return cat.icone;
  }
  const key = DEFAULT_ICON_BY_NAME[normalizeName(cat.nome)];
  return ICON_LIBRARY[key] || GENERIC_ICON;
}
function categoryIconBadge(cat, size) {
  const cls = size === 'lg' ? 'cat-icon-badge lg' : 'cat-icon-badge';
  if (!cat) return `<span class="${cls}" style="background:#8888881f;color:#888">${GENERIC_ICON}</span>`;
  return `<span class="${cls}" style="background:${cat.cor}22;color:${cat.cor}">${categoryIcon(cat)}</span>`;
}

// ---------- Avatar de pessoa ----------
function pessoaAvatarBadge(pessoa, size) {
  const px = size === 'lg' ? 34 : size === 'sm' ? 16 : 22;
  const fontPx = Math.round(px * 0.42);
  if (!pessoa) {
    return `<span class="avatar-badge" style="width:${px}px;height:${px}px;background:#8888881f;color:#888;font-size:${fontPx}px">?</span>`;
  }
  if (pessoa.avatar) {
    return `<img class="avatar-badge" src="${pessoa.avatar}" style="width:${px}px;height:${px}px" alt="">`;
  }
  const inicial = escapeHtml((pessoa.nome || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="avatar-badge" style="width:${px}px;height:${px}px;background:${pessoa.cor}22;color:${pessoa.cor};font-size:${fontPx}px">${inicial}</span>`;
}

function resizeImageToDataUrl(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const minSide = Math.min(img.width, img.height);
      const sx = (img.width - minSide) / 2;
      const sy = (img.height - minSide) / 2;
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível carregar a imagem.'));
    };
    img.src = url;
  });
}

function getCategoria(id) {
  return data.categories.find((c) => c.id === id);
}
function getPessoa(id) {
  return data.pessoas.find((p) => p.id === id);
}
function pessoaMatches(item) {
  if (currentPessoaFilter === 'todos') return true;
  return item.pessoaId === currentPessoaFilter;
}
function clampDay(year, monthIndex, day) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(day, lastDay);
}
function transactionSign(t) {
  if (t.tipo === 'receita') return 1;
  if (t.tipo === 'despesa') return -1;
  if (t.tipo === 'balanco') return t.operacao === 'subtrai' ? -1 : 1;
  return 0;
}
function monthDiff(fromKey, toKey) {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
function recorrenteParcelaInfo(rec, key) {
  if (rec.repeticao !== 'limitada') return null;
  const inicio = rec.inicioMes || key;
  const numero = monthDiff(inicio, key) + 1;
  return { numero, total: rec.parcelas, ativo: numero >= 1 && numero <= rec.parcelas };
}
function recorrenteAtivoNoMes(rec, key) {
  const inicio = rec.inicioMes || key;
  if (monthDiff(inicio, key) < 0) return false;
  if (rec.repeticao === 'limitada') {
    const info = recorrenteParcelaInfo(rec, key);
    return !!(info && info.ativo);
  }
  return true;
}
const DIAS_ANTECEDENCIA_VENCE_EM_BREVE = 3;

function recorrenteStatusInfo(rec, pago, refDate) {
  if (pago) return { label: 'Pago', cls: 'status-pago', urgency: null };
  const ref = refDate || currentDate;
  const day = clampDay(ref.getFullYear(), ref.getMonth(), rec.dia);
  const dueDate = new Date(ref.getFullYear(), ref.getMonth(), day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);
  const diffDias = Math.round((dueDate.getTime() - today.getTime()) / 86400000);

  if (diffDias === 0) return { label: 'Vence hoje', cls: 'status-vence-hoje', urgency: 'hoje' };
  if (diffDias > 0 && diffDias <= DIAS_ANTECEDENCIA_VENCE_EM_BREVE) {
    return { label: 'Vence em breve', cls: 'status-aguardando', urgency: 'breve' };
  }
  if (diffDias > 0) {
    return rec.tipo === 'receita'
      ? { label: 'A receber', cls: 'status-aguardando', urgency: null }
      : { label: 'A pagar', cls: 'status-aguardando', urgency: null };
  }
  return { label: 'Pendente', cls: 'status-pendente', urgency: 'vencida' };
}

// ---------- Ordenação ----------
function applySort(list, cmp, field, dir) {
  const mult = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => mult * cmp(a, b, field));
}

const SORT_DEFAULT_DIR = {
  data: 'desc',
  descricao: 'asc',
  categoria: 'asc',
  pessoa: 'asc',
  valor: 'desc',
  dia: 'asc',
  tipo: 'asc',
};

function compareTransacoes(a, b, field) {
  switch (field) {
    case 'data':
      return a.data.localeCompare(b.data);
    case 'descricao':
      return a.descricao.localeCompare(b.descricao, 'pt-BR');
    case 'categoria':
      return (getCategoria(a.categoriaId)?.nome || '').localeCompare(getCategoria(b.categoriaId)?.nome || '', 'pt-BR');
    case 'pessoa':
      return (getPessoa(a.pessoaId)?.nome || '').localeCompare(getPessoa(b.pessoaId)?.nome || '', 'pt-BR');
    case 'valor':
      return a.valor - b.valor;
    default:
      return 0;
  }
}

function compareRecorrentes(a, b, field) {
  switch (field) {
    case 'descricao':
      return a.descricao.localeCompare(b.descricao, 'pt-BR');
    case 'categoria':
      return (getCategoria(a.categoriaId)?.nome || '').localeCompare(getCategoria(b.categoriaId)?.nome || '', 'pt-BR');
    case 'pessoa':
      return (getPessoa(a.pessoaId)?.nome || '').localeCompare(getPessoa(b.pessoaId)?.nome || '', 'pt-BR');
    case 'dia':
      return a.dia - b.dia;
    case 'valor':
      return a.valor - b.valor;
    case 'tipo':
      return a.tipo.localeCompare(b.tipo);
    default:
      return 0;
  }
}

function updateSortArrows(selector, sortState) {
  document.querySelectorAll(`${selector} th[data-field]`).forEach((th) => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    arrow.textContent = th.dataset.field === sortState.field ? (sortState.dir === 'asc' ? '▲' : '▼') : '';
  });
}

let transacoesSort = { field: 'data', dir: 'desc' };
let recorrentesTableSort = { field: 'dia', dir: 'asc' };

document.querySelector('#view-transacoes thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-field]');
  if (!th) return;
  const field = th.dataset.field;
  if (transacoesSort.field === field) {
    transacoesSort.dir = transacoesSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    transacoesSort = { field, dir: SORT_DEFAULT_DIR[field] || 'asc' };
  }
  renderTransacoes();
});

document.querySelector('#view-recorrentes thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-field]');
  if (!th) return;
  const field = th.dataset.field;
  if (recorrentesTableSort.field === field) {
    recorrentesTableSort.dir = recorrentesTableSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    recorrentesTableSort = { field, dir: SORT_DEFAULT_DIR[field] || 'asc' };
  }
  renderRecorrentes();
});

let recorrentesSortModeAberto = 'vencimento';
let recorrentesSortModePago = 'vencimento';

document.getElementById('recorrentes-sort-select-aberto').addEventListener('change', (e) => {
  recorrentesSortModeAberto = e.target.value;
  renderDashboard();
});
document.getElementById('recorrentes-sort-select-pago').addEventListener('change', (e) => {
  recorrentesSortModePago = e.target.value;
  renderDashboard();
});

function sortDashboardRecorrentes(list, mode) {
  const arr = [...list];
  const byDia = (a, b) => a.dia - b.dia;
  switch (mode) {
    case 'valor':
      arr.sort((a, b) => b.valor - a.valor);
      break;
    case 'alfabetica':
      arr.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
      break;
    case 'categoria':
      arr.sort((a, b) => (getCategoria(a.categoriaId)?.nome || '').localeCompare(getCategoria(b.categoriaId)?.nome || '', 'pt-BR') || byDia(a, b));
      break;
    case 'vencimento':
    default:
      arr.sort(byDia);
  }
  return arr;
}

// ---------- Seleção múltipla (estilo Excel, desktop) ----------
let selectedKeys = new Set();

function toggleSelecao(key) {
  if (selectedKeys.has(key)) selectedKeys.delete(key);
  else selectedKeys.add(key);
  renderSelecaoUI();
}

function limparSelecao() {
  if (selectedKeys.size === 0) return;
  selectedKeys.clear();
  renderSelecaoUI();
}

function calcularSomaSelecao() {
  let soma = 0;
  selectedKeys.forEach((key) => {
    const idx = key.indexOf(':');
    const tipo = key.slice(0, idx);
    const id = key.slice(idx + 1);
    if (tipo === 'transacao') {
      const t = data.transactions.find((x) => x.id === id);
      if (t) soma += transactionSign(t) * t.valor;
    } else if (tipo === 'recorrente') {
      const r = data.recurring.find((x) => x.id === id);
      if (r) soma += (r.tipo === 'despesa' ? -1 : 1) * r.valor;
    }
  });
  return soma;
}

function renderSelecaoUI() {
  document.querySelectorAll('tr[data-selecao-key], .recorrente-row[data-selecao-key], .recent-expense-row[data-selecao-key]').forEach((el) => {
    el.classList.toggle('selecionado', selectedKeys.has(el.dataset.selecaoKey));
  });
  const widget = document.getElementById('selecao-resumo');
  if (selectedKeys.size === 0) {
    widget.classList.add('hidden');
    return;
  }
  widget.classList.remove('hidden');
  document.getElementById('selecao-resumo-valor').textContent = formatCurrency(calcularSomaSelecao());
}

function handleSelecaoClick(e, key) {
  if (!(e.ctrlKey || e.metaKey)) return false;
  e.preventDefault();
  toggleSelecao(key);
  return true;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') limparSelecao();
});

// ---------- Navegação ----------
function toggleSidebar(open) {
  document.getElementById('sidebar').classList.toggle('open', open);
  document.getElementById('sidebar-overlay').classList.toggle('open', open);
}
document.getElementById('btn-hamburger').addEventListener('click', () => toggleSidebar(true));
document.getElementById('sidebar-overlay').addEventListener('click', () => toggleSidebar(false));

document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    toggleSidebar(false);
  });
});

function changeMonth(delta) {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + delta, 1);
  renderAll();
}
document.getElementById('month-prev').addEventListener('click', () => changeMonth(-1));
document.getElementById('month-next').addEventListener('click', () => changeMonth(1));
document.getElementById('month-prev-2').addEventListener('click', () => changeMonth(-1));
document.getElementById('month-next-2').addEventListener('click', () => changeMonth(1));

// ---------- Render geral ----------
function renderAll() {
  const label = capitalize(monthLabel(currentDate));
  document.getElementById('month-label').textContent = label;
  document.getElementById('month-label-2').textContent = label;
  populateCategorySelects();
  populatePessoaSelects();
  renderPessoaFilterControls();
  renderDashboard();
  renderTransacoes();
  renderRecorrentes();
  renderCategorias();
  renderPessoas();
  renderSinoDot();
  renderSelecaoUI();
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function populateCategorySelects() {
  const opts = data.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
  document.getElementById('t-categoria').innerHTML = opts;
  document.getElementById('r-categoria').innerHTML = opts;
}

function populatePessoaSelects() {
  const opts = data.pessoas.map((p) => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('');
  document.getElementById('t-pessoa').innerHTML = opts;
  document.getElementById('r-pessoa').innerHTML = opts;
}

function renderPessoaFilterControls() {
  const options = [{ id: 'todos', nome: 'Todos' }, ...data.pessoas];
  const html = options
    .map((o) => `<button type="button" class="pill-btn ${currentPessoaFilter === o.id ? 'active' : ''}" data-pessoa="${o.id}">${escapeHtml(o.nome)}</button>`)
    .join('');
  document.getElementById('pessoa-filter').innerHTML = html;
  document.getElementById('pessoa-filter-2').innerHTML = html;
}

['pessoa-filter', 'pessoa-filter-2'].forEach((id) => {
  document.getElementById(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-pessoa]');
    if (!btn) return;
    currentPessoaFilter = btn.dataset.pessoa;
    renderAll();
  });
});

// ---------- Dashboard ----------
function pendentesRecorrentesPorTipo(tipo, key) {
  return data.recurring
    .filter((r) => {
      if (!pessoaMatches(r) || r.ativo === false || r.tipo !== tipo) return false;
      if ((r.pagoMeses || []).includes(key)) return false;
      return recorrenteAtivoNoMes(r, key);
    })
    .reduce((a, r) => a + r.valor, 0);
}

function renderDashboard() {
  const key = monthKey(currentDate);
  const pessoaTx = data.transactions.filter(pessoaMatches);
  const saldoTotal = pessoaTx.reduce((acc, t) => acc + transactionSign(t) * t.valor, 0);
  const monthTx = pessoaTx.filter((t) => t.data.slice(0, 7) === key);
  const receitas = monthTx.filter((t) => t.tipo === 'receita').reduce((a, t) => a + t.valor, 0);
  const despesas = monthTx.filter((t) => t.tipo === 'despesa').reduce((a, t) => a + t.valor, 0);
  const aReceber = pendentesRecorrentesPorTipo('receita', key);
  const aPagar = pendentesRecorrentesPorTipo('despesa', key);
  const saldoPrevisto = saldoTotal + aReceber - aPagar;

  document.getElementById('stat-saldo').textContent = formatCurrency(saldoTotal);
  document.getElementById('stat-receitas').textContent = formatCurrency(receitas);
  document.getElementById('stat-despesas').textContent = formatCurrency(despesas);
  document.getElementById('stat-a-receber').textContent = formatCurrency(aReceber);
  document.getElementById('stat-a-pagar').textContent = formatCurrency(aPagar);
  const previstoEl = document.getElementById('stat-saldo-previsto');
  previstoEl.textContent = formatCurrency(saldoPrevisto);
  previstoEl.classList.toggle('positive', saldoPrevisto >= 0);
  previstoEl.classList.toggle('negative', saldoPrevisto < 0);

  renderDespesasCard(key);
  renderChartMeses();
  renderDashboardRecorrentes(key);
  renderComparativo(key);
}

function renderComparativo(key) {
  const card = document.getElementById('card-comparativo');
  if (currentPessoaFilter !== 'todos' || data.pessoas.length < 2) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  const tbody = document.getElementById('comparativo-tbody');
  tbody.innerHTML = data.pessoas
    .map((p) => {
      const monthTx = data.transactions.filter((t) => t.pessoaId === p.id && t.data.slice(0, 7) === key);
      const receitas = monthTx.filter((t) => t.tipo === 'receita').reduce((a, t) => a + t.valor, 0);
      const despesas = monthTx.filter((t) => t.tipo === 'despesa').reduce((a, t) => a + t.valor, 0);
      return `<tr>
        <td>${pessoaAvatarBadge(p)}${escapeHtml(p.nome)}</td>
        <td class="right amount-receita">${formatCurrency(receitas)}</td>
        <td class="right amount-despesa">${formatCurrency(despesas)}</td>
        <td class="right">${formatCurrency(receitas - despesas)}</td>
      </tr>`;
    })
    .join('');
}

let despesasViewMode = 'recentes';

document.getElementById('despesas-view-select').addEventListener('change', (e) => {
  despesasViewMode = e.target.value;
  renderDespesasCard(monthKey(currentDate));
});

document.getElementById('chart-categorias').addEventListener('click', (e) => {
  const rowSel = e.target.closest('[data-selecao-key]');
  if (rowSel) handleSelecaoClick(e, rowSel.dataset.selecaoKey);
});

function renderDespesasCard(key) {
  document.getElementById('despesas-view-select').value = despesasViewMode;
  if (despesasViewMode === 'recentes') {
    renderDespesasRecentesList();
  } else {
    renderPieCategorias(key);
  }
}

function renderDespesasRecentesList() {
  const container = document.getElementById('chart-categorias');
  const txs = data.transactions
    .filter((t) => pessoaMatches(t) && t.tipo === 'despesa')
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, 10);
  if (txs.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhuma despesa lançada ainda.</div>';
    return;
  }
  container.innerHTML = txs
    .map((t) => {
      const cat = getCategoria(t.categoriaId);
      return `
    <div class="recent-expense-row" data-selecao-key="transacao:${t.id}">
      ${categoryIconBadge(cat)}
      <div class="recent-expense-info">
        <div class="recent-expense-desc">${escapeHtml(t.descricao)}</div>
        <div class="recent-expense-date">${formatDateBR(t.data)}</div>
      </div>
      <div class="recent-expense-valor amount-despesa">- ${formatCurrency(t.valor)}</div>
    </div>`;
    })
    .join('');
}

function renderPieCategorias(key) {
  const totals = {};
  data.transactions
    .filter((t) => pessoaMatches(t) && t.data.slice(0, 7) === key && t.tipo === 'despesa')
    .forEach((t) => {
      totals[t.categoriaId] = (totals[t.categoriaId] || 0) + t.valor;
    });
  const rows = Object.entries(totals)
    .map(([catId, val]) => ({ cat: getCategoria(catId), val }))
    .sort((a, b) => b.val - a.val);
  const container = document.getElementById('chart-categorias');
  if (rows.length === 0) {
    container.innerHTML = '<div class="empty-state">Sem despesas neste mês.</div>';
    return;
  }
  const total = rows.reduce((a, r) => a + r.val, 0);
  const size = 160;
  const radius = 62;
  const stroke = 24;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  let acc = 0;
  const circles = rows
    .map((r) => {
      const color = r.cat ? r.cat.cor : '#888888';
      const dash = (r.val / total) * circumference;
      const circle = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${cx} ${cy})"/>`;
      acc += dash;
      return circle;
    })
    .join('');
  const svg = `<svg viewBox="0 0 ${size} ${size}" class="pie-svg">${circles}</svg>`;
  const legend = rows
    .map((r) => {
      const pct = Math.round((r.val / total) * 100);
      return `<div class="legend-item">
      <div class="legend-left">${categoryIconBadge(r.cat)}${r.cat ? escapeHtml(r.cat.nome) : 'Sem categoria'}</div>
      <div class="legend-value">${formatCurrency(r.val)} · ${pct}%</div>
    </div>`;
    })
    .join('');
  container.innerHTML = `<div class="pie-layout"><div class="pie-svg-wrap">${svg}</div><div class="pie-legend">${legend}</div></div>`;
}

function renderChartMeses() {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    months.push(new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1));
  }
  const totals = months.map((d) => {
    const key = monthKey(d);
    const txs = data.transactions.filter((t) => pessoaMatches(t) && t.data.slice(0, 7) === key);
    return {
      d,
      receitas: txs.filter((t) => t.tipo === 'receita').reduce((a, t) => a + t.valor, 0),
      despesas: txs.filter((t) => t.tipo === 'despesa').reduce((a, t) => a + t.valor, 0),
    };
  });
  const max = Math.max(1, ...totals.flatMap((t) => [t.receitas, t.despesas]));
  const container = document.getElementById('chart-meses');
  container.innerHTML =
    '<div class="months-chart">' +
    totals
      .map(
        (t) => `
      <div class="month-col">
        <div class="month-bars">
          <div class="mbar mbar-receita" style="height:${(t.receitas / max) * 100}%" title="Receitas: ${formatCurrency(t.receitas)}"></div>
          <div class="mbar mbar-despesa" style="height:${(t.despesas / max) * 100}%" title="Despesas: ${formatCurrency(t.despesas)}"></div>
        </div>
        <div class="month-col-label">${capitalize(t.d.toLocaleDateString('pt-BR', { month: 'short' })).replace('.', '')}</div>
      </div>`
      )
      .join('') +
    '</div>';
}

function renderRecorrenteRow(r, pago, key, refDate) {
  const cat = getCategoria(r.categoriaId);
  const pessoa = getPessoa(r.pessoaId);
  const status = recorrenteStatusInfo(r, pago, refDate);
  const parcelaInfo = recorrenteParcelaInfo(r, key);
  const parcelaLabel = parcelaInfo ? ` · parcela ${parcelaInfo.numero}/${parcelaInfo.total}` : '';
  const urgenciaClass = status.urgency ? ` row-urgencia-${status.urgency}` : '';
  return `
      <div class="recorrente-row${urgenciaClass}" data-selecao-key="recorrente:${r.id}">
        ${categoryIconBadge(cat)}
        <div class="desc">${escapeHtml(r.descricao)} <span style="color:var(--text-muted)">— dia ${r.dia}${pessoa ? ' · ' + escapeHtml(pessoa.nome) : ''}${parcelaLabel}</span></div>
        <div class="valor ${r.tipo === 'despesa' ? 'amount-despesa' : 'amount-receita'}">${formatCurrency(r.valor)}</div>
        <span class="status-pill ${status.cls}">${status.label}</span>
        <button data-id="${r.id}" data-key="${key}" data-action="${pago ? 'undo' : 'pay'}">${pago ? 'Desfazer' : 'Marcar pago'}</button>
      </div>`;
}

function renderDashboardRecorrentes(key) {
  const abertoContainer = document.getElementById('dashboard-recorrentes-aberto');
  const pagoContainer = document.getElementById('dashboard-recorrentes-pago');
  const items = data.recurring.filter((r) => pessoaMatches(r) && r.ativo !== false && recorrenteAtivoNoMes(r, key));

  let abertos = [];
  let pagos = [];
  items.forEach((r) => ((r.pagoMeses || []).includes(key) ? pagos : abertos).push(r));

  document.getElementById('recorrentes-sort-select-aberto').value = recorrentesSortModeAberto;
  document.getElementById('recorrentes-sort-select-pago').value = recorrentesSortModePago;

  abertos = sortDashboardRecorrentes(abertos, recorrentesSortModeAberto);
  pagos = sortDashboardRecorrentes(pagos, recorrentesSortModePago);

  abertoContainer.innerHTML = abertos.length
    ? abertos.map((r) => renderRecorrenteRow(r, false, key)).join('')
    : '<div class="empty-state">Nenhuma conta em aberto.</div>';
  pagoContainer.innerHTML = pagos.length
    ? pagos.map((r) => renderRecorrenteRow(r, true, key)).join('')
    : '<div class="empty-state">Nenhuma conta paga ainda.</div>';
}

const URGENCIA_ORDEM = { vencida: 0, hoje: 1, breve: 2 };

function getContasNotificadas() {
  const hoje = new Date();
  const key = monthKey(hoje);
  return data.recurring
    .filter((r) => r.ativo !== false && recorrenteAtivoNoMes(r, key) && !(r.pagoMeses || []).includes(key))
    .map((r) => ({ rec: r, status: recorrenteStatusInfo(r, false, hoje) }))
    .filter((x) => x.status.urgency)
    .sort((a, b) => URGENCIA_ORDEM[a.status.urgency] - URGENCIA_ORDEM[b.status.urgency]);
}

function renderSinoDot() {
  const temNotificacao = getContasNotificadas().length > 0;
  document.getElementById('sino-dot').classList.toggle('hidden', !temNotificacao);
  document.getElementById('sino-dot-mobile').classList.toggle('hidden', !temNotificacao);
}

function renderNotificacoesModal() {
  const hoje = new Date();
  const key = monthKey(hoje);
  const notificadas = getContasNotificadas();
  const container = document.getElementById('notificacoes-list');
  container.innerHTML = notificadas.length
    ? notificadas.map((x) => renderRecorrenteRow(x.rec, false, key, hoje)).join('')
    : '<div class="empty-state">Nenhuma conta precisando de atenção agora.</div>';
}

function abrirNotificacoes() {
  renderNotificacoesModal();
  openModal(document.getElementById('modal-notificacoes'));
}
document.getElementById('btn-sino').addEventListener('click', abrirNotificacoes);
document.getElementById('btn-sino-mobile').addEventListener('click', abrirNotificacoes);

function openConfirmarPagamento(rec, key) {
  document.getElementById('cp-recorrente-id').value = rec.id;
  document.getElementById('cp-key').value = key;
  document.getElementById('modal-confirmar-title').textContent = `Confirmar pagamento — ${rec.descricao}`;
  document.getElementById('cp-valor').value = rec.valor;
  openModal(document.getElementById('modal-confirmar-pagamento'));
}

function desfazerPagamento(rec, key) {
  rec.pagoMeses = (rec.pagoMeses || []).filter((k) => k !== key);
  data.transactions = data.transactions.filter((t) => !(t.recorrenteId === rec.id && t.data.slice(0, 7) === key));
  scheduleSave();
  renderAll();
}

function handleRecorrenteActionClick(e) {
  const rowSel = e.target.closest('[data-selecao-key]');
  if (rowSel && handleSelecaoClick(e, rowSel.dataset.selecaoKey)) return;
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const rec = data.recurring.find((r) => r.id === btn.dataset.id);
  if (!rec) return;
  const key = btn.dataset.key;
  if (btn.dataset.action === 'pay') {
    openConfirmarPagamento(rec, key);
  } else {
    desfazerPagamento(rec, key);
  }
}

document.getElementById('dashboard-recorrentes-row').addEventListener('click', handleRecorrenteActionClick);
document.getElementById('notificacoes-list').addEventListener('click', handleRecorrenteActionClick);

document.getElementById('form-confirmar-pagamento').addEventListener('submit', (e) => {
  e.preventDefault();
  const rec = data.recurring.find((r) => r.id === document.getElementById('cp-recorrente-id').value);
  if (!rec) return;
  const key = document.getElementById('cp-key').value;
  const valorPago = parseFloat(document.getElementById('cp-valor').value);
  const [ano, mes] = key.split('-').map(Number);
  const day = clampDay(ano, mes - 1, rec.dia);
  const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  data.transactions.push({
    id: uid(),
    tipo: rec.tipo,
    descricao: rec.descricao,
    valor: valorPago,
    data: dateStr,
    categoriaId: rec.categoriaId,
    pessoaId: rec.pessoaId,
    recorrenteId: rec.id,
  });
  rec.pagoMeses = rec.pagoMeses || [];
  rec.pagoMeses.push(key);
  rec.valor = valorPago;
  scheduleSave();
  closeModals();
  renderAll();
});

// ---------- Transações ----------
function renderTransacoes() {
  const key = monthKey(currentDate);
  updateSortArrows('#view-transacoes thead', transacoesSort);
  let txs = data.transactions.filter((t) => pessoaMatches(t) && t.data.slice(0, 7) === key);
  txs = applySort(txs, compareTransacoes, transacoesSort.field, transacoesSort.dir);
  const tbody = document.getElementById('transacoes-tbody');
  const empty = document.getElementById('transacoes-empty');
  if (txs.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tbody.innerHTML = txs
    .map((t) => {
      const isBalanco = t.tipo === 'balanco';
      const sinalNegativo = t.tipo === 'despesa' || (isBalanco && t.operacao === 'subtrai');
      const categoriaCell = isBalanco
        ? '<span class="balanco-badge">Balanço</span>'
        : (() => {
            const cat = getCategoria(t.categoriaId);
            return `${categoryIconBadge(cat)}${cat ? escapeHtml(cat.nome) : '—'}`;
          })();
      const pessoa = getPessoa(t.pessoaId);
      const pessoaCell = pessoa ? `${pessoaAvatarBadge(pessoa)}${escapeHtml(pessoa.nome)}` : '—';
      return `<tr data-id="${t.id}" data-selecao-key="transacao:${t.id}">
      <td>${formatDateBR(t.data)}</td>
      <td>${escapeHtml(t.descricao)}${t.rascunho ? ' <span class="balanco-badge">Ajustar</span>' : ''}</td>
      <td>${categoriaCell}</td>
      <td>${pessoaCell}</td>
      <td class="right ${sinalNegativo ? 'amount-despesa' : 'amount-receita'}">${sinalNegativo ? '-' : '+'} ${formatCurrency(t.valor)}</td>
      <td class="row-actions">
        ${rowActionIcon('duplicate', DUPLICATE_ICON, t.id, 'Duplicar')}
        ${rowActionIcon('delete', TRASH_ICON, t.id, 'Excluir')}
      </td>
    </tr>`;
    })
    .join('');
}

function deleteTransacao(id) {
  if (!confirm('Excluir esta transação?')) return false;
  data.transactions = data.transactions.filter((t) => t.id !== id);
  scheduleSave();
  renderAll();
  return true;
}

function duplicateTransacao(id) {
  const t = data.transactions.find((x) => x.id === id);
  if (!t) return;
  const hoje = new Date();
  const novo = { ...t, id: uid() };
  novo.data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  data.transactions.push(novo);
  currentDate = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  scheduleSave();
  renderAll();
}

document.getElementById('transacoes-tbody').addEventListener('click', (e) => {
  const trSel = e.target.closest('tr[data-selecao-key]');
  if (trSel && handleSelecaoClick(e, trSel.dataset.selecaoKey)) return;
  const delIcon = e.target.closest('[data-role="delete"]');
  if (delIcon) {
    deleteTransacao(delIcon.dataset.id);
    return;
  }
  const dupIcon = e.target.closest('[data-role="duplicate"]');
  if (dupIcon) {
    duplicateTransacao(dupIcon.dataset.id);
    return;
  }
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  openTransacaoModal(tr.dataset.id);
});
document.getElementById('btn-add-transacao').addEventListener('click', () => openTransacaoModal(null));

document.getElementById('btn-fab-rapido').addEventListener('click', () => {
  document.getElementById('form-rapido').reset();
  openModal(document.getElementById('modal-rapido'));
});

document.getElementById('form-rapido').addEventListener('submit', (e) => {
  e.preventDefault();
  const tipo = document.querySelector('input[name="q-tipo"]:checked').value;
  const descricao = document.getElementById('q-desc').value.trim();
  const valor = parseFloat(document.getElementById('q-valor').value);
  const hoje = new Date();
  const dataStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  data.transactions.push({
    id: uid(),
    tipo,
    descricao,
    valor,
    data: dataStr,
    categoriaId: null,
    pessoaId: null,
    rascunho: true,
  });
  currentDate = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  scheduleSave();
  closeModals();
  renderAll();
});

function updateTransacaoFormVisibility() {
  const tipo = document.querySelector('input[name="t-tipo"]:checked').value;
  const isBalanco = tipo === 'balanco';
  document.getElementById('t-operacao-row').classList.toggle('hidden', !isBalanco);
  document.getElementById('t-categoria-row').classList.toggle('hidden', isBalanco);
  document.getElementById('t-categoria').required = !isBalanco;
}
document.querySelectorAll('input[name="t-tipo"]').forEach((r) => r.addEventListener('change', updateTransacaoFormVisibility));

function openTransacaoModal(id) {
  const form = document.getElementById('form-transacao');
  form.reset();
  document.getElementById('t-id').value = id || '';
  document.getElementById('btn-delete-transacao').classList.toggle('hidden', !id);
  document.getElementById('modal-transacao-title').textContent = id ? 'Editar transação' : 'Nova transação';

  if (id) {
    const t = data.transactions.find((x) => x.id === id);
    form.querySelector(`input[name="t-tipo"][value="${t.tipo}"]`).checked = true;
    if (t.tipo === 'balanco') {
      form.querySelector(`input[name="t-operacao"][value="${t.operacao || 'soma'}"]`).checked = true;
    }
    document.getElementById('t-desc').value = t.descricao;
    document.getElementById('t-valor').value = t.valor;
    document.getElementById('t-data').value = t.data;
    if (t.categoriaId) document.getElementById('t-categoria').value = t.categoriaId;
    if (t.pessoaId) document.getElementById('t-pessoa').value = t.pessoaId;
  } else {
    const today = new Date();
    const defaultDate =
      monthKey(currentDate) === monthKey(today)
        ? today.toISOString().slice(0, 10)
        : `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-01`;
    document.getElementById('t-data').value = defaultDate;
  }
  updateTransacaoFormVisibility();
  openModal(document.getElementById('modal-transacao'));
}

document.getElementById('form-transacao').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('t-id').value;
  const tipo = document.querySelector('input[name="t-tipo"]:checked').value;
  const isBalanco = tipo === 'balanco';
  const operacao = isBalanco ? document.querySelector('input[name="t-operacao"]:checked').value : undefined;
  const descricao = document.getElementById('t-desc').value.trim();
  const valor = parseFloat(document.getElementById('t-valor').value);
  const dataStr = document.getElementById('t-data').value;
  const categoriaId = isBalanco ? null : document.getElementById('t-categoria').value;
  const pessoaId = document.getElementById('t-pessoa').value;

  if (id) {
    const t = data.transactions.find((x) => x.id === id);
    Object.assign(t, { tipo, operacao, descricao, valor, data: dataStr, categoriaId, pessoaId });
    delete t.rascunho;
  } else {
    data.transactions.push({ id: uid(), tipo, operacao, descricao, valor, data: dataStr, categoriaId, pessoaId });
  }
  scheduleSave();
  closeModals();
  renderAll();
});

document.getElementById('btn-delete-transacao').addEventListener('click', () => {
  const id = document.getElementById('t-id').value;
  if (deleteTransacao(id)) closeModals();
});

// ---------- Contas fixas (recorrentes) ----------
function renderRecorrentes() {
  updateSortArrows('#view-recorrentes thead', recorrentesTableSort);
  const tbody = document.getElementById('recorrentes-tbody');
  const empty = document.getElementById('recorrentes-empty');
  const items = applySort(data.recurring, compareRecorrentes, recorrentesTableSort.field, recorrentesTableSort.dir);
  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tbody.innerHTML = items
    .map((r) => {
      const cat = getCategoria(r.categoriaId);
      const pessoa = getPessoa(r.pessoaId);
      return `<tr data-id="${r.id}" data-selecao-key="recorrente:${r.id}">
      <td>${escapeHtml(r.descricao)}</td>
      <td>${categoryIconBadge(cat)}${cat ? escapeHtml(cat.nome) : '—'}</td>
      <td>${pessoa ? `${pessoaAvatarBadge(pessoa)}${escapeHtml(pessoa.nome)}` : '—'}</td>
      <td>${r.dia}</td>
      <td class="right ${r.tipo === 'despesa' ? 'amount-despesa' : 'amount-receita'}">${formatCurrency(r.valor)}</td>
      <td>${r.tipo === 'despesa' ? 'Despesa' : 'Receita'}</td>
      <td>${r.repeticao === 'limitada' ? `${r.parcelas}x` : 'Sempre'}</td>
      <td class="row-actions">${rowActionIcon('delete', TRASH_ICON, r.id, 'Excluir')}</td>
    </tr>`;
    })
    .join('');
}

document.getElementById('recorrentes-tbody').addEventListener('click', (e) => {
  const trSel = e.target.closest('tr[data-selecao-key]');
  if (trSel && handleSelecaoClick(e, trSel.dataset.selecaoKey)) return;
  const delIcon = e.target.closest('[data-role="delete"]');
  if (delIcon) {
    deleteRecorrente(delIcon.dataset.id);
    return;
  }
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  openRecorrenteModal(tr.dataset.id);
});
document.getElementById('btn-add-recorrente').addEventListener('click', () => openRecorrenteModal(null));

function updateRecorrenteFormVisibility() {
  const rep = document.querySelector('input[name="r-repeticao"]:checked').value;
  const isLimitada = rep === 'limitada';
  document.getElementById('r-parcelas-row').classList.toggle('hidden', !isLimitada);
  document.getElementById('r-parcelas').required = isLimitada;
}
document.querySelectorAll('input[name="r-repeticao"]').forEach((r) => r.addEventListener('change', updateRecorrenteFormVisibility));

function openRecorrenteModal(id) {
  const form = document.getElementById('form-recorrente');
  form.reset();
  document.getElementById('r-id').value = id || '';
  document.getElementById('btn-delete-recorrente').classList.toggle('hidden', !id);
  document.getElementById('modal-recorrente-title').textContent = id ? 'Editar conta fixa' : 'Nova conta fixa';
  document.getElementById('r-inicio-row').classList.toggle('hidden', !!id);

  if (id) {
    const r = data.recurring.find((x) => x.id === id);
    form.querySelector(`input[name="r-tipo"][value="${r.tipo}"]`).checked = true;
    document.getElementById('r-desc').value = r.descricao;
    document.getElementById('r-valor').value = r.valor;
    document.getElementById('r-dia').value = r.dia;
    document.getElementById('r-categoria').value = r.categoriaId;
    if (r.pessoaId) document.getElementById('r-pessoa').value = r.pessoaId;
    if (r.repeticao === 'limitada') {
      form.querySelector('input[name="r-repeticao"][value="limitada"]').checked = true;
      document.getElementById('r-parcelas').value = r.parcelas;
    }
  }
  updateRecorrenteFormVisibility();
  openModal(document.getElementById('modal-recorrente'));
}

document.getElementById('form-recorrente').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('r-id').value;
  const tipo = document.querySelector('input[name="r-tipo"]:checked').value;
  const descricao = document.getElementById('r-desc').value.trim();
  const valor = parseFloat(document.getElementById('r-valor').value);
  const dia = parseInt(document.getElementById('r-dia').value, 10);
  const categoriaId = document.getElementById('r-categoria').value;
  const pessoaId = document.getElementById('r-pessoa').value;
  const repeticao = document.querySelector('input[name="r-repeticao"]:checked').value;
  const parcelas = repeticao === 'limitada' ? parseInt(document.getElementById('r-parcelas').value, 10) : undefined;

  if (id) {
    const r = data.recurring.find((x) => x.id === id);
    Object.assign(r, { tipo, descricao, valor, dia, categoriaId, pessoaId, repeticao });
    if (repeticao === 'limitada') r.parcelas = parcelas;
    else delete r.parcelas;
    if (!r.inicioMes) r.inicioMes = monthKey(currentDate);
  } else {
    const inicioSel = document.querySelector('input[name="r-inicio"]:checked').value;
    const inicioMes =
      inicioSel === 'proximo' ? monthKey(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)) : monthKey(currentDate);
    const novo = { id: uid(), tipo, descricao, valor, dia, categoriaId, pessoaId, repeticao, inicioMes, ativo: true, pagoMeses: [] };
    if (repeticao === 'limitada') novo.parcelas = parcelas;
    data.recurring.push(novo);
  }
  scheduleSave();
  closeModals();
  renderAll();
});

function deleteRecorrente(id) {
  if (!confirm('Excluir esta conta fixa? As transações já geradas por ela não serão apagadas.')) return false;
  data.recurring = data.recurring.filter((r) => r.id !== id);
  scheduleSave();
  renderAll();
  return true;
}

document.getElementById('btn-delete-recorrente').addEventListener('click', () => {
  const id = document.getElementById('r-id').value;
  if (deleteRecorrente(id)) closeModals();
});

// ---------- Categorias ----------
function renderCategorias() {
  const container = document.getElementById('categorias-list');
  container.innerHTML = data.categories
    .map(
      (c) => `
    <div class="categoria-row" data-id="${c.id}">
      ${categoryIconBadge(c, 'lg')}
      <span class="nome">${escapeHtml(c.nome)}</span>
      ${rowActionIcon('delete', TRASH_ICON, c.id, 'Excluir')}
    </div>`
    )
    .join('');
}

document.getElementById('categorias-list').addEventListener('click', (e) => {
  const delIcon = e.target.closest('[data-role="delete"]');
  if (delIcon) {
    deleteCategoria(delIcon.dataset.id);
    return;
  }
  const row = e.target.closest('.categoria-row');
  if (!row) return;
  openCategoriaModal(row.dataset.id);
});
document.getElementById('btn-add-categoria').addEventListener('click', () => openCategoriaModal(null));

let selectedIconKey = GENERIC_ICON_KEY;

function renderIconGrid() {
  const cor = document.getElementById('c-cor').value;
  const grid = document.getElementById('c-icone-grid');
  grid.innerHTML = Object.keys(ICON_LIBRARY)
    .map((key) => {
      const selected = key === selectedIconKey ? ' selected' : '';
      const label = ICON_LABELS[key] || key;
      return `<button type="button" class="icon-grid-btn${selected}" data-icon="${key}" title="${label}" style="color:${cor}">${ICON_LIBRARY[key]}</button>`;
    })
    .join('');
}

document.getElementById('c-cor').addEventListener('input', renderIconGrid);
document.getElementById('c-icone-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.icon-grid-btn');
  if (!btn) return;
  selectedIconKey = btn.dataset.icon;
  renderIconGrid();
});

function openCategoriaModal(id) {
  const form = document.getElementById('form-categoria');
  form.reset();
  document.getElementById('c-id').value = id || '';
  document.getElementById('btn-delete-categoria').classList.toggle('hidden', !id);
  document.getElementById('modal-categoria-title').textContent = id ? 'Editar categoria' : 'Nova categoria';

  if (id) {
    const c = data.categories.find((x) => x.id === id);
    document.getElementById('c-nome').value = c.nome;
    document.getElementById('c-cor').value = c.cor;
    selectedIconKey = (c.icone && ICON_LIBRARY[c.icone] ? c.icone : null) || DEFAULT_ICON_BY_NAME[normalizeName(c.nome)] || GENERIC_ICON_KEY;
  } else {
    document.getElementById('c-cor').value = '#d4a95e';
    selectedIconKey = GENERIC_ICON_KEY;
  }
  renderIconGrid();
  openModal(document.getElementById('modal-categoria'));
}

document.getElementById('form-categoria').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('c-id').value;
  const nome = document.getElementById('c-nome').value.trim();
  const cor = document.getElementById('c-cor').value;

  if (id) {
    const c = data.categories.find((x) => x.id === id);
    Object.assign(c, { nome, cor, icone: selectedIconKey });
  } else {
    data.categories.push({ id: uid(), nome, cor, icone: selectedIconKey });
  }
  scheduleSave();
  closeModals();
  renderAll();
});

function deleteCategoria(id) {
  if (!confirm('Excluir esta categoria? Transações que a usam ficarão sem categoria.')) return false;
  data.categories = data.categories.filter((c) => c.id !== id);
  scheduleSave();
  renderAll();
  return true;
}

document.getElementById('btn-delete-categoria').addEventListener('click', () => {
  const id = document.getElementById('c-id').value;
  if (deleteCategoria(id)) closeModals();
});

// ---------- Pessoas ----------
function renderPessoas() {
  const container = document.getElementById('pessoas-list');
  container.innerHTML = data.pessoas
    .map(
      (p) => `
    <div class="categoria-row" data-id="${p.id}">
      ${pessoaAvatarBadge(p, 'lg')}
      <span class="nome">${escapeHtml(p.nome)}</span>
      ${rowActionIcon('delete', TRASH_ICON, p.id, 'Excluir')}
    </div>`
    )
    .join('');
}

document.getElementById('pessoas-list').addEventListener('click', (e) => {
  const delIcon = e.target.closest('[data-role="delete"]');
  if (delIcon) {
    deletePessoa(delIcon.dataset.id);
    return;
  }
  const row = e.target.closest('.categoria-row');
  if (!row) return;
  openPessoaModal(row.dataset.id);
});
document.getElementById('btn-add-pessoa').addEventListener('click', () => openPessoaModal(null));

let pendingAvatarDataUrl = undefined;
let pendingAvatarRemoved = false;

function currentEditingPessoa() {
  const id = document.getElementById('p-id').value;
  return id ? data.pessoas.find((x) => x.id === id) : null;
}

function renderAvatarPreview() {
  const existing = currentEditingPessoa();
  let src = null;
  if (pendingAvatarDataUrl) src = pendingAvatarDataUrl;
  else if (!pendingAvatarRemoved && existing && existing.avatar) src = existing.avatar;
  const preview = document.getElementById('p-avatar-preview');
  if (src) {
    preview.innerHTML = `<img src="${src}" alt="">`;
  } else {
    const nome = document.getElementById('p-nome').value || '?';
    preview.textContent = nome.trim().charAt(0).toUpperCase() || '?';
  }
  document.getElementById('btn-remove-avatar').classList.toggle('hidden', !src);
}

document.getElementById('p-nome').addEventListener('input', renderAvatarPreview);
document.getElementById('btn-upload-avatar').addEventListener('click', () => document.getElementById('p-avatar-file').click());
document.getElementById('btn-remove-avatar').addEventListener('click', () => {
  pendingAvatarDataUrl = undefined;
  pendingAvatarRemoved = true;
  renderAvatarPreview();
});
document.getElementById('p-avatar-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Escolha um arquivo de imagem.');
    e.target.value = '';
    return;
  }
  try {
    pendingAvatarDataUrl = await resizeImageToDataUrl(file, 160);
    pendingAvatarRemoved = false;
    renderAvatarPreview();
  } catch (err) {
    alert('Não foi possível processar essa imagem.');
  }
  e.target.value = '';
});

function openPessoaModal(id) {
  const form = document.getElementById('form-pessoa');
  form.reset();
  document.getElementById('p-id').value = id || '';
  document.getElementById('btn-delete-pessoa').classList.toggle('hidden', !id);
  document.getElementById('modal-pessoa-title').textContent = id ? 'Editar pessoa' : 'Nova pessoa';
  pendingAvatarDataUrl = undefined;
  pendingAvatarRemoved = false;

  if (id) {
    const p = data.pessoas.find((x) => x.id === id);
    document.getElementById('p-nome').value = p.nome;
    document.getElementById('p-cor').value = p.cor;
  } else {
    document.getElementById('p-cor').value = '#d4a95e';
  }
  renderAvatarPreview();
  openModal(document.getElementById('modal-pessoa'));
}

document.getElementById('form-pessoa').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('p-id').value;
  const nome = document.getElementById('p-nome').value.trim();
  const cor = document.getElementById('p-cor').value;

  if (id) {
    const p = data.pessoas.find((x) => x.id === id);
    Object.assign(p, { nome, cor });
    if (pendingAvatarDataUrl) p.avatar = pendingAvatarDataUrl;
    else if (pendingAvatarRemoved) delete p.avatar;
  } else {
    const novo = { id: uid(), nome, cor };
    if (pendingAvatarDataUrl) novo.avatar = pendingAvatarDataUrl;
    data.pessoas.push(novo);
  }
  scheduleSave();
  closeModals();
  renderAll();
});

function deletePessoa(id) {
  if (!confirm('Excluir esta pessoa? Transações e contas fixas dela ficarão sem pessoa vinculada.')) return false;
  data.pessoas = data.pessoas.filter((p) => p.id !== id);
  if (currentPessoaFilter === id) currentPessoaFilter = 'todos';
  scheduleSave();
  renderAll();
  return true;
}

document.getElementById('btn-delete-pessoa').addEventListener('click', () => {
  const id = document.getElementById('p-id').value;
  if (deletePessoa(id)) closeModals();
});

// ---------- Modais genéricos ----------
function openModal(modalEl) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  modalEl.classList.remove('hidden');
}
function closeModals() {
  document.getElementById('modal-overlay').classList.add('hidden');
}
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') closeModals();
});
document.querySelectorAll('.modal-cancel').forEach((btn) => btn.addEventListener('click', closeModals));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModals();
});

// ---------- Start ----------
waitForGoogleScript(50);
