// Estado global da aplicação
let currentUser = null;
let currentPage = 1;
let totalPages = 1;
let selectedMemories = new Set();
let guildNameMap = {};
let userNameCache = {};

try {
    const cachedUsers = localStorage.getItem('alfred_username_cache');
    if (cachedUsers) userNameCache = JSON.parse(cachedUsers);
} catch (e) {
    console.error('Erro ao carregar cache de usuários:', e);
}

// Elementos DOM
const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const logoutBtn = document.getElementById('logoutBtn');
const currentUserSpan = document.getElementById('currentUser');
const loadingSpinner = document.getElementById('loadingSpinner');
const modalOverlay = document.getElementById('modalOverlay');

// API Base URL
const API_BASE = window.location.origin;

// Utilitários
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function showLoading() {
    loadingSpinner.classList.remove('hidden');
}

function hideLoading() {
    loadingSpinner.classList.add('hidden');
}

function showNotification(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    else if (type === 'error') icon = 'times-circle';
    else if (type === 'warning') icon = 'exclamation-triangle';

    toast.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR');
}

function truncateText(text, maxLength = 100) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// Music Control
let pollInterval = null;
let currentGuildId = 'default'; // Needs to be set dynamically or select first

async function updateMusicWidget() {
    if (!currentUser) return;

    if (currentGuildId === 'default') {
        try {
            const res = await fetch(`${API_BASE}/api/guilds`);
            const data = await res.json();
            const common = data.guilds.filter(g => g.in_common);
            if (common.length > 0) {
                currentGuildId = common[0].id;
                populateMusicServerSelect(common);
            }
        } catch (e) { }
    }

    if (currentGuildId === 'default') return;

    try {
        const res = await fetch(`${API_BASE}/api/music/status/${currentGuildId}`);
        const status = await res.json();

        // Safe element updates
        const titleEl = document.getElementById('musicTitle');
        if (titleEl) titleEl.textContent = status.current?.title || 'Nenhuma música tocando';

        const artistEl = document.getElementById('musicArtist');
        if (artistEl) artistEl.textContent = status.current?.artist || '--';

        const coverEl = document.getElementById('musicCover');
        if (coverEl) coverEl.src = status.current?.thumbnail || 'https://via.placeholder.com/150';

        const btnPlay = document.getElementById('btnPlayPause');
        if (btnPlay) {
            btnPlay.innerHTML = status.playing ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
        }

        const volSlider = document.getElementById('volumeSlider');
        if (volSlider) volSlider.value = status.volume;

        const autoCheck = document.getElementById('autoplayCheck');
        if (autoCheck) autoCheck.checked = status.autoplay;

        // Live indicator
        const indicator = document.querySelector('.live-indicator');
        if (indicator) indicator.style.display = status.playing ? 'block' : 'none';

    } catch (e) {
        console.error('Music Poll Error', e);
    }
}

function populateMusicServerSelect(guilds) {
    const select = document.getElementById('musicServerSelect');
    if (!select) return;
    
    select.innerHTML = '';
    guilds.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        if (g.id === currentGuildId) opt.selected = true;
        select.appendChild(opt);
    });

    select.onchange = (e) => {
        currentGuildId = e.target.value;
        updateMusicWidget();
    };
}

window.togglePlayPause = async () => {
    const btn = document.getElementById('btnPlayPause');
    if (!btn) return;
    const isPlaying = btn.querySelector('.fa-pause') !== null;
    await musicControl(isPlaying ? 'pause' : 'resume');
};

window.adjustVolume = async (val) => {
    await musicControl('volume', val);
};

async function musicControl(action, value = null) {
    if (currentGuildId === 'default') return showNotification('Nenhum servidor selecionado', 'error');

    try {
        const res = await fetch(`${API_BASE}/api/music/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, guildId: currentGuildId, value })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Falha no comando');
        }

        updateMusicWidget(); // Force update
    } catch (e) {
        showNotification(e.message, 'error');
    }
}

// Start polling
function startMusicPolling() {
    if (pollInterval) clearInterval(pollInterval);
    updateMusicWidget();
    pollInterval = setInterval(updateMusicWidget, 3000);
}
// Stop polling on logout or tab switch
function stopMusicPolling() {
    if (pollInterval) clearInterval(pollInterval);
}

// Autenticação
async function checkAuthStatus() {
    try {
        const response = await fetch(`${API_BASE}/api/auth/status`);
        const data = await response.json();

        if (data.authenticated) {
            currentUser = data.user;
            showDashboard();
            startMusicPolling();
        } else {
            showLogin();
        }
    } catch (error) {
        console.error('Erro ao verificar autenticação:', error);
        showLogin();
    }
}

async function login(username, password) {
    try {
        showLoading();

        const response = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            // Buscar status atualizado para garantir currentUser correto
            const statusResp = await fetch(`${API_BASE}/api/auth/status`);
            const statusData = await statusResp.json();
            currentUser = statusData.user;
            showDashboard();
            showNotification('Login realizado com sucesso');
        } else {
            showNotification(data.error || 'Erro no login', 'error');
        }
    } catch (error) {
        console.error('Erro no login:', error);
        showNotification('Erro de conexão', 'error');
    } finally {
        hideLoading();
    }
}

async function logout() {
    try {
        await fetch(`${API_BASE}/api/logout`, { method: 'POST' });
        currentUser = null;
        showLogin();
        showNotification('Logout realizado com sucesso');
    } catch (error) {
        console.error('Erro no logout:', error);
    }
}

function showLogin() {
    loginScreen.classList.remove('hidden');
    dashboard.classList.add('hidden');
}

async function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    currentUserSpan.textContent = typeof currentUser === 'object' && currentUser !== null ? (currentUser.username || '') : (currentUser || '');
    loadOverview();
}

// Navegação
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.dataset.tab;

            // Atualizar navegação
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Mostrar conteúdo
            tabContents.forEach(tab => tab.classList.remove('active'));
            document.getElementById(targetTab).classList.add('active');

            // Carregar dados da aba
            switch (targetTab) {
                case 'overview':
                    loadOverview();
                    break;
                case 'servers':
                    loadServers();
                    break;
                case 'memories':
                    loadMemories();
                    break;
                case 'whitelist':
                    setupWhitelistGuildSelector();
                    break;
            }
        });
    });
}

// Overview
async function loadOverview() {
    try {
        showLoading();

        const response = await fetch(`${API_BASE}/api/stats`);
        const stats = await response.json();

        // Atualizar estatísticas
        document.getElementById('totalMemories').textContent = stats.totalMemories.toLocaleString();
        document.getElementById('totalGuilds').textContent = stats.totalGuilds.toLocaleString();
        document.getElementById('totalUsers').textContent = stats.totalUsers.toLocaleString();
        document.getElementById('recentMemories').textContent = stats.recentMemories.toLocaleString();

        // Renderizar gráficos
        // Remover funções relacionadas a Top Servidores e Top Usuários
        // Remover fetchGuildNames, renderTopGuildsChart, fetchUserNames, renderTopUsersChart, e chamadas relacionadas

    } catch (error) {
        console.error('Erro ao carregar estatísticas:', error);
        showNotification('Erro ao carregar estatísticas', 'error');
    } finally {
        hideLoading();
    }
}

// Memórias
async function loadMemories(page = 1, filters = {}) {
    try {
        showLoading();

        const params = new URLSearchParams({
            limit: 50,
            offset: (page - 1) * 50,
            ...filters
        });

        const response = await fetch(`${API_BASE}/api/memories?${params}`);
        const data = await response.json();

        currentPage = page;
        totalPages = Math.ceil(data.total / 50);

        renderMemoriesTable(data.memories);
        updatePagination();

    } catch (error) {
        console.error('Erro ao carregar memórias:', error);
        showNotification('Erro ao carregar memórias', 'error');
    } finally {
        hideLoading();
    }
}

async function renderMemoriesTable(memories) {
    const tbody = document.getElementById('memoriesTableBody');
    if (memories.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px;">Nenhuma memória encontrada</td></tr>';
        return;
    }
    // Buscar nomes de servidores e usuários
    const guildIds = [...new Set(memories.map(m => m.guild_id).filter(Boolean))];
    await fetchGuildNames(guildIds);
    for (const guildId of guildIds) {
        const userIds = [...new Set(memories.filter(m => m.guild_id === guildId).map(m => m.user_id).filter(Boolean))];
        await fetchUserNames(guildId, userIds);
    }
    const rows = memories.map(memory => {
        const guildName = guildNameMap[memory.guild_id] || memory.guild_id || '-';
        const userName = userNameCache[memory.user_id] || memory.user_id || '-';
        return `
        <tr>
            <td>
                <input type="checkbox" class="memory-checkbox" value="${memory.id}">
            </td>
            <td>${memory.id}</td>
            <td title="ID: ${memory.guild_id}"><span class="server-name-cell">${guildName}<button class="copy-id-btn" title="Copiar ID" onclick="copyToClipboard('${memory.guild_id}')"><i class="fas fa-copy"></i></button></span></td>
            <td title="ID: ${memory.user_id}">${userName}</td>
            <td class="message-cell" onclick="toggleMessageExpansion(this)">
                ${truncateText(memory.message)}
            </td>
            <td>${formatDate(memory.timestamp)}</td>
            <td>
                <button class="btn btn-danger btn-sm" onclick="deleteMemory(${memory.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
        `;
    }).join('');
    tbody.innerHTML = rows;
    document.querySelectorAll('.memory-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', updateSelectedMemories);
    });
}

function toggleMessageExpansion(cell) {
    cell.classList.toggle('expanded');
}

function updateSelectedMemories() {
    selectedMemories.clear();
    document.querySelectorAll('.memory-checkbox:checked').forEach(checkbox => {
        selectedMemories.add(checkbox.value);
    });

    // Atualizar botão de limpar
    const clearBtn = document.getElementById('clearMemoriesBtn');
    clearBtn.textContent = `Limpar Selecionadas (${selectedMemories.size})`;
}

function updatePagination() {
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');

    pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;
}

async function deleteMemory(id) {
    if (!confirm('Tem certeza que deseja deletar esta memória?')) return;

    try {
        const response = await fetch(`${API_BASE}/api/memories/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Memória deletada com sucesso');
            loadMemories(currentPage);
        } else {
            showNotification(data.error || 'Erro ao deletar memória', 'error');
        }
    } catch (error) {
        console.error('Erro ao deletar memória:', error);
        showNotification('Erro ao deletar memória', 'error');
    }
}

async function clearSelectedMemories() {
    if (selectedMemories.size === 0) {
        showNotification('Selecione memórias para deletar', 'error');
        return;
    }

    if (!confirm(`Tem certeza que deseja deletar ${selectedMemories.size} memórias?`)) return;

    try {
        const response = await fetch(`${API_BASE}/api/memories/bulk-delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids: Array.from(selectedMemories) })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message);
            selectedMemories.clear();
            loadMemories(currentPage);
        } else {
            showNotification(data.error || 'Erro ao deletar memórias', 'error');
        }
    } catch (error) {
        console.error('Erro ao deletar memórias:', error);
        showNotification('Erro ao deletar memórias', 'error');
    }
}

async function searchMemories() {
    const searchQuery = document.getElementById('memorySearch').value.trim();
    const guildFilter = document.getElementById('guildFilter').value.trim();
    const userFilter = document.getElementById('userFilter').value.trim();

    const filters = {};
    if (guildFilter) filters.guild_id = guildFilter;
    if (userFilter) filters.user_id = userFilter;

    if (searchQuery) {
        // Busca por similaridade
        try {
            const params = new URLSearchParams({
                query: searchQuery,
                guild_id: guildFilter,
                user_id: userFilter
            });

            const response = await fetch(`${API_BASE}/api/memories/search?${params}`);
            const data = await response.json();

            renderMemoriesTable(data.memories);
            return;
        } catch (error) {
            console.error('Erro na busca:', error);
        }
    }

    // Busca normal com filtros
    loadMemories(1, filters);
}

// Whitelist
async function loadWhitelist() {
    const guildId = document.getElementById('whitelistGuildId').value.trim();

    if (!guildId) {
        document.getElementById('whitelistTableBody').innerHTML =
            '<tr><td colspan="4" style="text-align: center; padding: 40px;">Digite um ID de servidor para ver a whitelist</td></tr>';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/whitelist/${guildId}`);
        const whitelist = await response.json();

        renderWhitelistTable(whitelist, guildId);
    } catch (error) {
        console.error('Erro ao carregar whitelist:', error);
        showNotification('Erro ao carregar whitelist', 'error');
    }
}

function renderWhitelistTable(whitelist, guildId) {
    const tbody = document.getElementById('whitelistTableBody');

    if (whitelist.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px;">Nenhum item na whitelist</td></tr>';
        return;
    }

    const guildName = guildNameMap[guildId] || guildId;
    const rows = whitelist.map(item => `
        <tr>
            <td title="ID: ${guildId}"><span class="server-name-cell">${guildName}<button class="copy-id-btn" title="Copiar ID" onclick="copyToClipboard('${guildId}')"><i class="fas fa-copy"></i></button></span></td>
            <td>${item.type}</td>
            <td>${item.id}</td>
            <td>
                <button class="btn btn-danger btn-sm" onclick="removeFromWhitelist('${guildId}', '${item.type}', '${item.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');

    tbody.innerHTML = rows;
}

function showAddWhitelistModal() {
    const guildId = document.getElementById('whitelistGuildId').value.trim();

    if (!guildId) {
        showNotification('Digite um ID de servidor primeiro', 'error');
        return;
    }

    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');

    modalTitle.textContent = 'Adicionar à Whitelist';
    modalBody.innerHTML = `
        <form id="addWhitelistForm">
            <div class="form-group">
                <label for="whitelistType">Tipo</label>
                <select id="whitelistType" required>
                    <option value="user">Usuário</option>
                    <option value="role">Role</option>
                </select>
            </div>
            <div class="form-group">
                <label for="whitelistItemId">ID</label>
                <input type="text" id="whitelistItemId" required>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
                <button type="submit" class="btn btn-primary">Adicionar</button>
            </div>
        </form>
    `;

    showModal();

    // Adicionar event listener
    document.getElementById('addWhitelistForm').addEventListener('submit', addToWhitelist);
}

async function addToWhitelist(event) {
    event.preventDefault();

    const guildId = document.getElementById('whitelistGuildId').value;
    const type = document.getElementById('whitelistType').value;
    const id = document.getElementById('whitelistItemId').value;

    try {
        const response = await fetch(`${API_BASE}/api/whitelist`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ guild_id: guildId, type, id })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Item adicionado à whitelist');
            closeModal();
            loadWhitelist();
        } else {
            showNotification(data.error || 'Erro ao adicionar à whitelist', 'error');
        }
    } catch (error) {
        console.error('Erro ao adicionar à whitelist:', error);
        showNotification('Erro ao adicionar à whitelist', 'error');
    }
}

async function removeFromWhitelist(guildId, type, id) {
    if (!confirm('Tem certeza que deseja remover este item da whitelist?')) return;

    try {
        const response = await fetch(`${API_BASE}/api/whitelist/${guildId}/${type}/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Item removido da whitelist');
            loadWhitelist();
        } else {
            showNotification(data.error || 'Erro ao remover da whitelist', 'error');
        }
    } catch (error) {
        console.error('Erro ao remover da whitelist:', error);
        showNotification('Erro ao remover da whitelist', 'error');
    }
}

// Modal
function showModal() {
    modalOverlay.classList.remove('hidden');
}

function closeModal() {
    modalOverlay.classList.add('hidden');
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Verificar autenticação
    checkAuthStatus();

    // Inicializar navegação
    initNavigation();

    // Login form
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        login(username, password);
    });

    // Logout
    logoutBtn.addEventListener('click', logout);

    // Modal close
    document.querySelector('.modal-close').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    // Memories controls
    document.getElementById('searchBtn').addEventListener('click', searchMemories);
    document.getElementById('filterBtn').addEventListener('click', searchMemories);
    document.getElementById('clearMemoriesBtn').addEventListener('click', clearSelectedMemories);
    document.getElementById('selectAll').addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.memory-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = e.target.checked;
        });
        updateSelectedMemories();
    });

    // Pagination
    document.getElementById('prevPage').addEventListener('click', () => {
        if (currentPage > 1) {
            loadMemories(currentPage - 1);
        }
    });

    document.getElementById('nextPage').addEventListener('click', () => {
        if (currentPage < totalPages) {
            loadMemories(currentPage + 1);
        }
    });

    // Whitelist
    document.getElementById('addWhitelistBtn').addEventListener('click', showAddWhitelistModal);
    document.getElementById('whitelistGuildId').addEventListener('input', debounce(loadWhitelist, 450));

    // Live search debounced
    const memorySearchEl = document.getElementById('memorySearch');
    if (memorySearchEl) {
        memorySearchEl.addEventListener('input', debounce(searchMemories, 450));
        memorySearchEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchMemories();
        });
    }

    // Estatísticas como botões
    const statMemories = document.getElementById('statMemories');
    const statGuilds = document.getElementById('statGuilds');
    const statUsers = document.getElementById('statUsers');
    const navItems = document.querySelectorAll('.nav-item');
    const memoriesTab = document.getElementById('memories');
    const guildFilter = document.getElementById('guildFilter');
    const userFilter = document.getElementById('userFilter');

    function activateTab(tabName) {
        navItems.forEach(nav => {
            if (nav.dataset.tab === tabName) nav.classList.add('active');
            else nav.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(tab => {
            if (tab.id === tabName) tab.classList.add('active');
            else tab.classList.remove('active');
        });
        // Carregar dados da aba
        switch (tabName) {
            case 'overview':
                loadOverview();
                break;
            case 'servers':
                loadServers();
                break;
            case 'memories':
                loadMemories();
                break;
            case 'whitelist':
                setupWhitelistGuildSelector();
                break;
        }
    }

    statMemories?.addEventListener('click', () => {
        activateTab('memories');
    });
    statMemories?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') statMemories.click(); });

    statGuilds?.addEventListener('click', () => {
        activateTab('servers');
    });
    statGuilds?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') statGuilds.click(); });

    statUsers?.addEventListener('click', () => {
        activateTab('whitelist');
    });
    statUsers?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') statUsers.click(); });
});

// --- WHITELIST: Painel de seleção de servidores ---
async function renderWhitelistGuildList() {
    const container = document.getElementById('whitelistGuildList');
    container.innerHTML = '<div style="padding:24px;text-align:center;color:#888;">Carregando servidores...</div>';
    try {
        const response = await fetch(`${API_BASE}/api/guilds`);
        const data = await response.json();
        let guilds = data.guilds || [];
        if (!currentUser?.isAdmin) {
            guilds = guilds.filter(g => g.in_common && g.isAdmin);
        }
        if (guilds.length === 0) {
            container.innerHTML = '<div style="padding:24px;text-align:center;color:#888;">Nenhum servidor disponível para gerenciar whitelist.</div>';
            return;
        }
        // Renderizar como cards bonitos
        const listHtml = guilds.map(g => `
            <div class="server-card improved whitelist-card" data-guild-id="${g.id}">
                <img class="server-icon big" src="${g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : 'https://cdn.jsdelivr.net/gh/edent/SuperTinyIcons/images/svg/discord.svg'}" alt="Icone do servidor">
                <div class="server-info">
                    <div class="server-name">${g.name}</div>
                    <div class="server-id">ID: <span>${g.id}</span> <button class="copy-id-btn" title="Copiar ID" onclick="copyToClipboard('${g.id}')"><i class="fas fa-copy"></i></button></div>
                </div>
            </div>
        `).join('');
        container.innerHTML = `<div class="servers-list">${listHtml}</div>`;
        // Adicionar evento de clique
        document.querySelectorAll('.whitelist-card').forEach(item => {
            item.addEventListener('click', () => {
                document.getElementById('whitelistGuildId').value = item.dataset.guildId;
                loadWhitelist();
                loadGuildMembersAndWhitelist(item.dataset.guildId);
                // Destacar selecionado
                document.querySelectorAll('.whitelist-card').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
            });
        });
    } catch (e) {
        container.innerHTML = '<div style="padding:24px;text-align:center;color:#e53e3e;">Erro ao carregar servidores.</div>';
    }
}

// Chamar renderWhitelistGuildList ao entrar na aba whitelist
async function setupWhitelistGuildSelector() {
    await renderWhitelistGuildList();
    const select = document.getElementById('whitelistGuildSelect');
    const input = document.getElementById('whitelistGuildId');
    try {
        const response = await fetch(`${API_BASE}/api/guilds`);
        const data = await response.json();
        // Filtrar apenas servidores em comum
        const guilds = (data.guilds || []).filter(g => g.in_common);
        if (guilds.length === 0) {
            select.style.display = 'none';
            input.style.display = '';
            input.value = '';
            return;
        }
        // Sempre mostra o select se houver pelo menos 1 em comum
        select.innerHTML = guilds.map(g => `<option value="${g.id}">${g.name} (${g.id})</option>`).join('');
        // Adiciona uma opção padrão se quiser forçar seleção
        if (guilds.length > 1) {
            select.insertAdjacentHTML('afterbegin', '<option value="" disabled selected>Selecione um servidor...</option>');
        }
        select.style.display = '';
        input.style.display = 'none';
        // Seleciona o primeiro por padrão se só houver um
        if (guilds.length === 1) {
            select.selectedIndex = 0;
            input.value = guilds[0].id;
            loadWhitelist();
        } else {
            // Se houver mais de um, aguarda seleção do usuário
            select.selectedIndex = 0;
            input.value = '';
            document.getElementById('whitelistTableBody').innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px;">Selecione um servidor para ver a whitelist</td></tr>';
        }
        select.onchange = () => {
            input.value = select.value;
            loadWhitelist();
        };
    } catch {
        select.style.display = 'none';
        input.style.display = '';
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('ID copiado!', 'success');
    });
}

// Adicionar UI de informações customizadas do servidor na tela de servidores
async function showGuildInfoEditor(guild) {
    const container = document.getElementById('serversTableContainer');
    container.innerHTML = '<div style="padding:32px;text-align:center;color:#888;">Carregando informações do servidor...</div>';
    try {
        const resp = await fetch(`${API_BASE}/api/guild-info/${guild.id}`);
        const data = await resp.json();
        container.innerHTML = `
        <div class="guild-info-editor-card card" style="max-width:520px;margin:40px auto 0 auto;">
            <h2 style="margin-bottom:18px;font-size:1.5em;color:var(--primary-color);font-weight:700;letter-spacing:-1px;">${guild.name}</h2>
            <div class="form-group" style="margin-bottom:22px;">
                <label for="guildInfoInput" style="font-weight:600;color:var(--text-primary);margin-bottom:8px;display:block;">Informações do Servidor</label>
                <textarea id="guildInfoInput" rows="4" placeholder="Ex: Aqui é proibido flood. Use canais de voz para música. Regras completas no #regras." style="width:100%;padding:14px 16px;border:1.5px solid var(--border-color);border-radius:var(--radius);font-size:1.08em;resize:vertical;background:var(--background-color);color:var(--text-primary);transition:var(--transition);text-align:left;">${data.info || ''}</textarea>
            </div>
            <div class="form-group" style="margin-bottom:28px;">
                <label for="guildPersonaInput" style="font-weight:600;color:var(--text-primary);margin-bottom:8px;display:block;">Instrução de Persona do Bot</label>
                <textarea id="guildPersonaInput" rows="3" placeholder="Ex: Fale como um bot divertido, use memes e trate todos com respeito." style="width:100%;padding:14px 16px;border:1.5px solid var(--border-color);border-radius:var(--radius);font-size:1.08em;resize:vertical;background:var(--background-color);color:var(--text-primary);transition:var(--transition);text-align:left;">${data.persona || ''}</textarea>
            </div>
            <div style="display:flex;gap:14px;justify-content:center;align-items:center;">
                <button class="btn btn-primary" id="saveGuildInfoBtn" style="min-width:110px;font-size:1.08em;text-align:center;display:inline-flex;align-items:center;justify-content:center;">Salvar</button>
                <button class="btn btn-outline" style="min-width:90px;font-size:1.08em;text-align:center;display:inline-flex;align-items:center;justify-content:center;" onclick="loadServers()">Voltar</button>
            </div>
        </div>
        `;
        document.getElementById('saveGuildInfoBtn').onclick = async () => {
            const info = document.getElementById('guildInfoInput').value;
            const persona = document.getElementById('guildPersonaInput').value;
            await fetch(`${API_BASE}/api/guild-info/${guild.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ info, persona })
            });
            showNotification('Informações salvas com sucesso!');
        };
    } catch (e) {
        container.innerHTML = '<div style="padding:32px;text-align:center;color:#e53e3e;">Erro ao carregar informações do servidor.</div>';
    }
}

// Alterar loadServers para chamar showGuildInfoEditor ao clicar em um card de servidor (apenas admin)
async function loadServers() {
    const container = document.getElementById('serversTableContainer');
    container.innerHTML = '<div style="padding:32px;text-align:center;color:#888;">Carregando servidores...</div>';
    try {
        const response = await fetch(`${API_BASE}/api/guilds`);
        const data = await response.json();
        const guilds = data.guilds || [];
        let whitelist = [];
        if (currentUser?.isAdmin) {
            // Buscar whitelist global
            const wlResp = await fetch(`${API_BASE}/api/guild-whitelist`);
            const wlData = await wlResp.json();
            whitelist = wlData.whitelist || [];
        }
        // Mostrar todos para admin global, só filtrar para usuário comum
        const guildsToShow = currentUser?.isAdmin ? guilds : guilds.filter(g => g.in_common);
        if (guildsToShow.length === 0) {
            let debugHtml = '';
            if (data.debug) {
                debugHtml = `<div style='margin-top:24px;font-size:14px;color:#999;text-align:left;background:#f8f9fa;padding:16px;border-radius:8px;border:1px solid #e9ecef;'>
                  <h4 style='margin:0 0 12px 0;color:#495057;'>🔍 Debug - Informações Técnicas:</h4>
                  <div style='margin-bottom:8px;'><strong>Servidores do Bot:</strong> ${data.debug.botGuildIds.length} encontrados</div>
                  <div style='margin-bottom:8px;'><strong>Servidores do Usuário:</strong> ${data.debug.userGuildIds.length} encontrados</div>
                  <div style='margin-bottom:8px;'><strong>Servidores em Comum:</strong> ${data.debug.commonGuildIds.length} encontrados</div>
                </div>`;
            }
            container.innerHTML = `<div style="padding:32px;text-align:center;color:#888;">
              <div style='margin-bottom:16px;'>${currentUser?.isAdmin ? 'O bot está em ' + guilds.length + ' servidor(es).' : 'Você não está em nenhum servidor onde o bot está presente.'}</div>
              <div style='font-size:14px;color:#6c757d;'>${currentUser?.isAdmin ? '' : 'O bot está em ' + guilds.length + ' servidor(es), mas você não participa de nenhum deles.'}</div>
              ${debugHtml}
            </div>`;
            return;
        }
        // renderizar os cards
        const cards = guildsToShow.map((g, idx) => {
            const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : 'https://cdn.jsdelivr.net/gh/edent/SuperTinyIcons/images/svg/discord.svg';
            let badge = '';
            if (g.owner) badge = '<span class="server-badge owner">Owner</span>';
            else if (g.isAdmin) badge = '<span class="server-badge admin">Admin</span>';
            let statusHtml = '';
            let actionBtn = '';
            if (currentUser?.isAdmin) {
                const autorizado = whitelist.includes(g.id);
                statusHtml = `<div style="margin-top:8px;font-size:14px;">
                  <span style="color:${autorizado ? '#10b981' : '#ef4444'};font-weight:bold;">
                    ${autorizado ? 'Autorizado' : 'Não autorizado'}
                  </span>
                </div>`;
                actionBtn = autorizado
                    ? `<button class="btn btn-danger btn-sm" onclick="removeGuildFromWhitelist('${g.id}')">Remover Autorização</button>`
                    : `<button class="btn btn-primary btn-sm" onclick="addGuildToWhitelist('${g.id}')">Autorizar</button>`;
            }
            // Remover onclick do card, adicionar data-idx para identificar
            return `
            <div class="server-card improved" data-guild-idx="${idx}" style="cursor:pointer;">
                <img class="server-icon big" src="${iconUrl}" alt="Icone do servidor">
                <div class="server-info">
                    <div class="server-name">${g.name} ${badge}</div>
                    <div class="server-id">ID: <span>${g.id}</span> <button class="copy-id-btn" title="Copiar ID" onclick="copyToClipboard('${g.id}');event.stopPropagation();"><i class="fas fa-copy"></i></button></div>
                    ${statusHtml}
                    ${actionBtn}
                </div>
            </div>
            `;
        }).join('');
        container.innerHTML = `<div class="servers-list">${cards}</div>`;
        // Adicionar event listener nos cards (apenas admin)
        if (currentUser?.isAdmin) {
            document.querySelectorAll('.server-card.improved').forEach((el, idx) => {
                el.addEventListener('click', (e) => {
                    // Evitar conflito com botões internos
                    if (e.target.closest('button')) return;
                    showGuildInfoEditor(guildsToShow[idx]);
                });
            });
        }
    } catch (e) {
        container.innerHTML = '<div style="padding:32px;text-align:center;color:#e53e3e;">Erro ao carregar servidores.</div>';
    }
}

// Nova função: carregar e exibir membros do servidor na whitelist
async function loadGuildMembersAndWhitelist(guildId) {
    const membersContainer = document.getElementById('whitelistMembersContainer');
    membersContainer.innerHTML = '<div style="padding:24px;text-align:center;color:#888;"><i class="fas fa-spinner fa-spin"></i> Carregando membros...</div>';
    try {
        // Busca real de membros
        const response = await fetch(`${API_BASE}/api/guild-members/${guildId}`);
        const allMembers = await response.json();

        // Check if response is an error or not an array
        if (!response.ok || !Array.isArray(allMembers)) {
            membersContainer.innerHTML = `<div style="padding:24px;text-align:center;color:#f59e0b;"><i class="fas fa-exclamation-triangle"></i> ${allMembers.error || 'Não foi possível carregar membros deste servidor.'}</div>`;
            return;
        }

        // Buscar whitelist real
        const wlResp = await fetch(`${API_BASE}/api/whitelist/${guildId}`);
        const whitelist = await wlResp.json();

        // Validate whitelist is array
        const wlArray = Array.isArray(whitelist) ? whitelist : [];

        const wlIds = wlArray.filter(item => item.type === 'user').map(item => item.id);
        const blockIds = wlArray.filter(item => item.type === 'block').map(item => item.id);
        // Admins que não estão bloqueados
        const admins = allMembers.filter(m => m.isAdmin && !blockIds.includes(m.id));
        // Usuários explicitamente na whitelist e não bloqueados
        const whitelisted = allMembers.filter(m => wlIds.includes(m.id) && !blockIds.includes(m.id));
        // Junta admins e whitelisted, sem duplicatas
        const canSave = [...admins, ...whitelisted].filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
        // Não podem salvar = todos menos quem pode
        const cannotSave = allMembers.filter(m => !canSave.some(c => c.id === m.id));
        // Renderizar listas
        membersContainer.innerHTML = `
        <div class="whitelist-members-flex">
            <div class="whitelist-members-list">
                <h3>Podem salvar comandos</h3>
                <ul>
                    ${canSave.length > 0 ? canSave.map(m => `<li><img src="${m.avatar}" class="avatar"> ${m.name}${m.isAdmin ? ' <span style=\"color:#6366f1;font-weight:bold;font-size:13px;\">(admin)</span>' : ''} <button class="btn btn-danger btn-sm" onclick="removeFromWhitelistUser('${guildId}','user','${m.id}')">Remover</button></li>`).join('') : '<li style="color:#888;">Nenhum usuário</li>'}
                </ul>
            </div>
            <div class="whitelist-members-list">
                <h3>Não podem salvar comandos</h3>
                <ul>
                    ${cannotSave.length > 0 ? cannotSave.map(m => `<li><img src="${m.avatar}" class="avatar"> ${m.name}${m.isAdmin ? ' <span style=\"color:#6366f1;font-weight:bold;font-size:13px;\">(admin)</span>' : ''} <button class="btn btn-primary btn-sm" onclick="addToWhitelistUser('${guildId}','user','${m.id}')">Adicionar</button></li>`).join('') : '<li style="color:#888;">Nenhum usuário</li>'}
                </ul>
            </div>
        </div>
        `;
    } catch (e) {
        console.error('Erro ao carregar membros:', e);
        membersContainer.innerHTML = '<div style="padding:24px;text-align:center;color:#e53e3e;"><i class="fas fa-times-circle"></i> Erro ao carregar membros. Tente novamente.</div>';
    }
}
// Funções globais para adicionar/remover usuário da whitelist
window.addToWhitelistUser = async (guildId, type, id) => {
    await fetch(`${API_BASE}/api/whitelist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_id: guildId, type, id })
    });
    loadGuildMembersAndWhitelist(guildId);
    loadWhitelist();
};
window.removeFromWhitelistUser = async (guildId, type, id) => {
    await fetch(`${API_BASE}/api/whitelist/${guildId}/${type}/${id}`, { method: 'DELETE' });
    loadGuildMembersAndWhitelist(guildId);
    loadWhitelist();
};
// Funções globais para admin autorizar/remover guilds
window.addGuildToWhitelist = async (guildId) => {
    await fetch(`${API_BASE}/api/guild-whitelist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId })
    });
    loadServers();
};
window.removeGuildFromWhitelist = async (guildId) => {
    await fetch(`${API_BASE}/api/guild-whitelist/${guildId}`, { method: 'DELETE' });
    loadServers();
};

// Função para buscar nomes de usuários por guild e lista de IDs
async function fetchUserNames(guildId, userIds) {
    if (!guildId || !userIds || userIds.length === 0) return;
    // Evita buscar nomes já em cache
    const idsToFetch = userIds.filter(id => !userNameCache[id]);
    if (idsToFetch.length === 0) return;
    try {
        const params = new URLSearchParams({
            guild_id: guildId,
            user_ids: idsToFetch.join(',')
        });
        const response = await fetch(`${API_BASE}/api/usernames?${params}`);
        const data = await response.json();
        Object.assign(userNameCache, data);
        try {
            localStorage.setItem('alfred_username_cache', JSON.stringify(userNameCache));
        } catch (storageErr) {
            console.error('Erro ao salvar cache no localStorage:', storageErr);
        }
    } catch (e) {
        console.error('Erro ao buscar nomes de usuários:', e);
    }
}

// Função para buscar nomes de servidores por lista de IDs
async function fetchGuildNames(guildIds) {
    if (!guildIds || guildIds.length === 0) return;
    const idsToFetch = guildIds.filter(id => !guildNameMap[id]);
    if (idsToFetch.length === 0) return;
    try {
        const response = await fetch(`${API_BASE}/api/guilds`);
        const data = await response.json();
        const allGuilds = data.guilds || [];
        for (const g of allGuilds) {
            if (idsToFetch.includes(g.id)) {
                guildNameMap[g.id] = g.name;
            }
        }
    } catch (e) {
        console.error('Erro ao buscar nomes de servidores:', e);
    }
}

// ========================================
// MONITOR TAB FUNCTIONALITY
// ========================================
let monitorIntervals = { stats: null, logs: null };
let lastLogCount = 0;

async function loadMonitor() {
    // Clear any existing intervals
    clearMonitorIntervals();

    // Initial fetch
    await fetchSystemStats();
    await fetchSystemLogs();

    // Start polling
    monitorIntervals.stats = setInterval(fetchSystemStats, 3000);
    monitorIntervals.logs = setInterval(fetchSystemLogs, 2000);
}

function clearMonitorIntervals() {
    if (monitorIntervals.stats) clearInterval(monitorIntervals.stats);
    if (monitorIntervals.logs) clearInterval(monitorIntervals.logs);
    monitorIntervals = { stats: null, logs: null };
}

async function fetchSystemStats() {
    try {
        const response = await fetch(`${API_BASE}/api/system/stats`);
        const data = await response.json();

        // Monitor Tab
        const cpuEl = document.getElementById('cpuUsage');
        if (cpuEl) {
            cpuEl.textContent = `${data.cpu}%`;
            document.getElementById('ramUsage').textContent = `${data.ram.used}MB`;
            document.getElementById('uptime').textContent = data.uptime;
            document.getElementById('latency').textContent = data.latency !== '-' ? `${data.latency}ms` : '--ms';
        }

        // Overview Tab
        const pingEl = document.getElementById('botPing');
        if (pingEl) {
            pingEl.textContent = data.latency !== '-' ? `${data.latency}ms` : '--ms';
            document.getElementById('botUptime').textContent = data.uptime;
        }
    } catch (error) {
        console.error('Erro ao buscar stats:', error);
    }
}

async function fetchSystemLogs() {
    try {
        const response = await fetch(`${API_BASE}/api/system/logs?limit=50`);
        const data = await response.json();
        let logs = data.logs || [];

        // Filtro de pesquisa nos logs
        const filterInput = document.getElementById('logSearch');
        const filterVal = filterInput ? filterInput.value.trim().toLowerCase() : '';
        if (filterVal) {
            logs = logs.filter(log => log.toLowerCase().includes(filterVal));
        }

        // Atualizar se houver novos logs ou se a busca mudou
        const cacheKey = `${logs.length}_${filterVal}`;
        if (window._lastLogCacheKey === cacheKey) return;
        window._lastLogCacheKey = cacheKey;

        const consoleEl = document.getElementById('logConsole');
        if (!consoleEl) return;

        consoleEl.innerHTML = logs.map(log => {
            let logClass = 'info';
            if (log.includes('[ERROR]') || log.includes('error')) logClass = 'error';
            else if (log.includes('[WARN]') || log.includes('warn')) logClass = 'warn';
            return `<div class="log-line ${logClass}">${escapeHtml(log)}</div>`;
        }).join('');

        // Rolar até o fim se o autoScroll estiver ativo
        const scrollCheck = document.getElementById('autoScrollLogs');
        if (scrollCheck && scrollCheck.checked) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    } catch (error) {
        console.error('Erro ao buscar logs:', error);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function restartSystem() {
    if (!confirm('Tem certeza que deseja reiniciar o sistema?')) return;

    try {
        const response = await fetch(`${API_BASE}/api/system/restart`, { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showNotification('Sistema reiniciando... Aguarde.', 'success');
            // Poll for reconnection
            setTimeout(() => {
                showNotification('Reconectando...', 'success');
            }, 3000);
        } else {
            showNotification(data.error || 'Erro ao reiniciar', 'error');
        }
    } catch (error) {
        console.error('Erro ao reiniciar sistema:', error);
        showNotification('Erro ao reiniciar sistema', 'error');
    }
}

function clearConsole() {
    document.getElementById('logConsole').innerHTML = '<div class="log-line info">Console limpo.</div>';
    lastLogCount = 0;
}

// Add event listeners for Monitor tab
document.addEventListener('DOMContentLoaded', () => {
    const restartBtn = document.getElementById('restartBtn');
    const clearLogsBtn = document.getElementById('clearLogsBtn');
    const logSearch = document.getElementById('logSearch');

    if (restartBtn) restartBtn.addEventListener('click', restartSystem);
    if (clearLogsBtn) clearLogsBtn.addEventListener('click', clearConsole);
    if (logSearch) {
        logSearch.addEventListener('input', debounce(fetchSystemLogs, 300));
    }
});

// Extend tab navigation to handle monitor
const originalInitNav = initNavigation;
initNavigation = function () {
    originalInitNav();

    // Add monitor handler to nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;

            // Handle Monitor Polling
            if (tab === 'monitor') {
                loadMonitor();
            } else {
                clearMonitorIntervals();
            }

            // Handle Overview Polling
            if (tab === 'overview') {
                startOverviewPolling();
                startMusicPolling();
            } else {
                stopOverviewPolling();
                stopMusicPolling();
            }
        });
    });

    // Start polling if initial tab is overview
    if (document.querySelector('.nav-item.active').dataset.tab === 'overview') {
        startOverviewPolling();
        startMusicPolling();
    }
};

// ============================================
// Overview Widgets
// ============================================

let overviewInterval = null;

function startOverviewPolling() {
    if (overviewInterval) clearInterval(overviewInterval);
    loadOverviewData();
    overviewInterval = setInterval(loadOverviewData, 5000);
}

function stopOverviewPolling() {
    if (overviewInterval) clearInterval(overviewInterval);
    overviewInterval = null;
}

async function loadOverviewData() {
    await Promise.all([
        loadMusicWidget(),
        loadDailyStats(),
        fetchSystemStats()
    ]);
}

async function loadDailyStats() {
    try {
        const response = await fetch(`${API_BASE}/api/stats/daily`);
        const data = await response.json();

        const cmdEl = document.getElementById('dailyCmds');
        const songEl = document.getElementById('dailySongs');

        if (cmdEl) cmdEl.textContent = data.commandsExecuted || 0;
        if (songEl) songEl.textContent = data.songsPlayed || 0;
    } catch (error) {
        console.error('Erro ao carregar stats diários:', error);
    }
}

async function loadMusicWidget() {
    try {
        const response = await fetch(`${API_BASE}/api/music/status`);
        const data = await response.json();
        const container = document.getElementById('musicStatusContent');
        if (!container) return;

        if (!data.connected) {
            container.innerHTML = `
                <p class="music-empty-state text-warning">
                    <i class="fas fa-exclamation-triangle"></i><br>
                    Lavalink desconectado
                </p>`;
            return;
        }

        if (data.activePlayers === 0) {
            container.innerHTML = `
                <p class="music-empty-state">
                    <i class="fas fa-headphones-alt"></i><br>
                    Nenhuma música tocando
                </p>`;
            return;
        }

        // Render Active Players
        const playersHtml = data.players.map(p => `
            <div class="music-player-item" style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; margin-bottom: 8px; border-left: 3px solid #22c55e;">
                <div style="font-weight: bold; color: #fff;">${escapeHtml(p.trackTitle)}</div>
                <div style="font-size: 0.9em; color: #aaa;">${escapeHtml(p.trackAuthor)}</div>
                <div style="font-size: 0.8em; margin-top: 4px; display: flex; justify-content: space-between;">
                    <span><i class="fas fa-server"></i> ${escapeHtml(p.guildName)}</span>
                    <span>${p.isPaused ? '<i class="fas fa-pause"></i> Pausado' : '<i class="fas fa-play"></i> Tocando'}</span>
                </div>
            </div>
        `).join('');

        container.innerHTML = `<div class="active-players-list">${playersHtml}</div>`;

    } catch (error) {
        console.error('Erro ao carregar widget de música:', error);
    }
}

window.showGuildInfoEditor = showGuildInfoEditor;

// ========================================
// 🔥 RELACIONAMENTOS TAB FUNCTIONALITY
// ========================================

async function loadRelationshipsGuildSelector() {
    const container = document.getElementById('relationshipGuildCards');
    if (!container) return;

    container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Carregando...</p>';

    try {
        const response = await fetch(`${API_BASE}/api/guilds`);
        const data = await response.json();
        const guilds = data.guilds || [];

        if (guilds.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Nenhum servidor encontrado.</p>';
            return;
        }

        // Renderizar cards compactos
        const cardsHtml = guilds.map(g => {
            const iconUrl = g.icon
                ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
                : 'https://cdn.jsdelivr.net/gh/edent/SuperTinyIcons/images/svg/discord.svg';
            return `
                <div class="relationship-server-card" data-guild-id="${g.id}" onclick="selectRelationshipGuild('${g.id}', this)">
                    <img class="rel-server-icon" src="${iconUrl}" alt="${escapeHtml(g.name)}">
                    <span class="rel-server-name">${escapeHtml(g.name)}</span>
                </div>
            `;
        }).join('');

        container.innerHTML = cardsHtml;
    } catch (error) {
        console.error('Erro ao carregar servidores:', error);
        container.innerHTML = '<p style="text-align: center; color: #e53e3e;">Erro ao carregar servidores.</p>';
    }
}

function selectRelationshipGuild(guildId, element) {
    // Destacar card selecionado
    document.querySelectorAll('.relationship-server-card').forEach(c => c.classList.remove('selected'));
    element.classList.add('selected');

    // Mostrar lista e carregar relacionamentos
    document.getElementById('relationshipsList').style.display = 'block';
    loadRelationships(guildId);
}

window.selectRelationshipGuild = selectRelationshipGuild;

async function loadRelationships(guildId) {
    const contentContainer = document.getElementById('relationshipsContent');
    contentContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Carregando...</p>';

    try {
        const response = await fetch(`${API_BASE}/api/relationships/${guildId}`);
        const data = await response.json();

        // Atualizar stats
        document.getElementById('totalNotes').textContent = data.total || 0;
        document.getElementById('totalRelUsers').textContent = data.relationships?.length || 0;

        if (!data.relationships || data.relationships.length === 0) {
            contentContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;"><i class="fas fa-heart-broken" style="font-size: 32px; display: block; margin-bottom: 12px;"></i>Nenhum relacionamento registrado neste servidor ainda.</p>';
            return;
        }

        renderRelationshipsList(data.relationships, guildId);
    } catch (error) {
        console.error('Erro ao carregar relacionamentos:', error);
        contentContainer.innerHTML = '<p style="text-align: center; color: #e53e3e;"><i class="fas fa-exclamation-triangle"></i> Erro ao carregar relacionamentos.</p>';
    }
}

function renderRelationshipsList(relationships, guildId) {
    const contentContainer = document.getElementById('relationshipsContent');

    const html = relationships.map(user => `
        <div class="relationship-user-card">
            <div class="relationship-user-header">
                <div class="relationship-user-info">
                    <i class="fas fa-user-circle" style="font-size: 32px; color: #e91e63;"></i>
                    <div>
                        <strong>${escapeHtml(user.username || 'Usuário Desconhecido')}</strong>
                        <small style="color: var(--text-secondary);">ID: ${user.user_id} • ${user.notes.length} nota(s)</small>
                    </div>
                </div>
            </div>
            <div class="relationship-notes">
                ${user.notes.map(note => `
                    <div class="relationship-note">
                        <div class="note-content">
                            <span class="note-category ${note.category}">${note.category}</span>
                            <span class="note-text">${escapeHtml(note.note)}</span>
                        </div>
                        <div class="note-meta">
                            <span class="note-date">${formatDate(note.timestamp)}</span>
                            <button class="btn btn-danger btn-sm" onclick="deleteRelationshipNote(${note.id}, '${guildId}')" title="Deletar nota">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');

    contentContainer.innerHTML = html || '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">Nenhum relacionamento encontrado.</p>';
}

async function deleteRelationshipNote(noteId, guildId) {
    if (!confirm('Tem certeza que deseja deletar esta nota?')) return;

    try {
        const response = await fetch(`${API_BASE}/api/relationships/${noteId}`, {
            method: 'DELETE'
        });
        const data = await response.json();

        if (data.success) {
            showNotification('Nota deletada com sucesso');
            loadRelationships(guildId);
        } else {
            showNotification(data.error || 'Erro ao deletar nota', 'error');
        }
    } catch (error) {
        console.error('Erro ao deletar nota:', error);
        showNotification('Erro ao deletar nota', 'error');
    }
}

// Adicionar handler para aba de relacionamentos
const originalInitNav2 = initNavigation;
initNavigation = function () {
    originalInitNav2();

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (item.dataset.tab === 'relationships') {
                loadRelationshipsGuildSelector();
            }
        });
    });
};

// Exportar função para uso global
window.deleteRelationshipNote = deleteRelationshipNote;