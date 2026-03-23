// popup.js - Управление отображением вкладок YouTube

class TabsManager {
    constructor() {
        // Элементы DOM
        this.elements = {
            loading: document.getElementById('loading'),
            tabsList: document.getElementById('tabs-list'),
            emptyState: document.getElementById('empty-state'),
            statsBar: document.getElementById('stats-bar'),
            totalTabs: document.getElementById('total-tabs'),
            activeTabs: document.getElementById('active-tabs'),
            statusText: document.getElementById('status-text')
        };

        this.tabs = [];

        // Привязка методов
        this.renderTabs = this.renderTabs.bind(this);
        this.updateStatus = this.updateStatus.bind(this);
        this.navigateAndClosePopup = this.navigateAndClosePopup.bind(this);
        this.closeTabAndRemove = this.closeTabAndRemove.bind(this);

        this.init();
    }

    async init() {
        await Promise.all([
            this.fetchTabs(),
            this.updateStatus()
        ]);
        
        // Обновляем список вкладок в реальном времени
        chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
            if (changeInfo.url?.includes('youtube.com')) {
                this.fetchAndRender();
            }
        });

        chrome.tabs.onRemoved.addListener(() => this.fetchAndRender());
        chrome.tabs.onCreated.addListener(() => this.fetchAndRender());

        // Обновляем статус каждую секунду
        setInterval(() => this.updateStatus(), 1000);
    }

    async fetchTabs() {
        try {
            // Получаем все вкладки во всех окнах
            const allTabs = await new Promise((resolve) => {
                chrome.tabs.query({}, (tabs) => resolve(tabs));
            });

            // Фильтруем только YouTube вкладки
            this.tabs = allTabs.filter(tab => 
                tab.url && tab.url.includes('youtube.com')
            );

            // Сортируем: активные сначала, потом по времени создания
            const activeWindowId = await new Promise((resolve) => {
                chrome.windows.getCurrent({ populate: false }, (window) => resolve(window.id));
            });
            
            let activeTabId = null;
            try {
                const [activeTab] = await chrome.tabs.query({ active: true, windowId: activeWindowId });
                activeTabId = activeTab?.id || null;
            } catch (e) {}

            this.tabs.sort((a, b) => {
                if (a.id === activeTabId && b.id !== activeTabId) return -1;
                if (b.id === activeTabId && a.id !== activeTabId) return 1;
                return b.id - a.id; // Новые вкладки сначала
            });

        } catch (error) {
            console.error('Ошибка получения вкладок:', error);
        }
    }

    async fetchAndRender() {
        await this.fetchTabs();
        this.renderTabs();
    }

    renderTabs() {
        // Скрываем лоадер
        this.elements.loading.style.display = 'none';

        if (this.tabs.length === 0) {
            // Нет вкладок - показываем empty state
            this.elements.tabsList.style.display = 'none';
            this.elements.emptyState.style.display = 'block';
            this.elements.statsBar.style.display = 'none';
            return;
        }

        // Отображаем список и статистику
        this.elements.emptyState.style.display = 'none';
        this.elements.statsBar.style.display = 'flex';

        // Считаем активные вкладки (с видео)
        const activeCount = this.tabs.filter(tab => 
            tab.url?.includes('watch?v=')
        ).length;

        this.elements.totalTabs.textContent = this.tabs.length;
        this.elements.activeTabs.textContent = activeCount;

        // Очищаем и создаем новые элементы списка
        this.elements.tabsList.innerHTML = '';

        for (const tab of this.tabs) {
            const li = document.createElement('li');
            li.className = 'tab-item';

            // Определяем иконку в зависимости от типа страницы
            let icon = '▶️';
            if (tab.url?.includes('watch?v=')) {
                icon = '🎬';
            } else if (tab.url?.includes('results?')) {
                icon = '🔍';
            } else if (tab.url?.includes('/channel/')) {
                icon = '📺';
            }

            // Извлекаем название видео из заголовка
            const title = this.extractVideoTitle(tab.title || 'YouTube');

            li.innerHTML = `
                <div class="tab-icon">${icon}</div>
                <div class="tab-info">
                    <div class="tab-title" title="${this.escapeHtml(title)}">${title}</div>
                    <div class="tab-url">${this.shortenUrl(tab.url)}</div>
                </div>
                <div class="tab-actions">
                    <button 
                        class="btn-tab btn-navigate" 
                        onclick="window.tabsManager.navigateAndClosePopup(${tab.id})"
                        title="Перейти на вкладку">
                        ⬅️
                    </button>
                    <button 
                        class="btn-tab btn-close" 
                        onclick="window.tabsManager.closeTabAndRemove(${tab.id})"
                        title="Закрыть вкладку">
                        ✕
                    </button>
                </div>
            `;

            this.elements.tabsList.appendChild(li);
        }

        this.elements.tabsList.style.display = 'block';
    }

    extractVideoTitle(title) {
        if (!title) return 'YouTube';
        
        // YouTube добавляет " - YouTube" в конец заголовка
        const youtubeSuffix = ' - YouTube';
        if (title.endsWith(youtubeSuffix)) {
            title = title.slice(0, -youtubeSuffix.length);
        }

        // Обрезаем слишком длинные заголовки
        if (title.length > 50) {
            return title.substring(0, 47) + '...';
        }

        return title;
    }

    shortenUrl(url) {
        try {
            const urlObj = new URL(url);
            let path = urlObj.pathname || '/';
            
            // Обрезаем путь если слишком длинный
            if (path.length > 30) {
                path = '/' + path.substring(1, 27) + '...';
            }

            return `${urlObj.hostname}${path}`;
        } catch (e) {
            return url || '';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async updateStatus() {
        try {
            chrome.runtime.sendMessage({ action: 'getTimerState' }, (response) => {
                if (chrome.runtime.lastError || !response) return;

                const state = response.state || 'VIEWING';
                const timeLeft = response.timeLeft || 0;

                let statusText = '';
                
                if (state === 'VIEWING') {
                    const minutes = Math.floor(timeLeft / 60);
                    const seconds = Math.floor(timeLeft % 60);
                    statusText = `⏱️ ${minutes}м ${seconds}с`;
                    this.elements.statusText.style.color = '#4CAF50';
                } else if (state === 'COOLDOWN') {
                    const minutes = Math.floor(timeLeft / 60);
                    const seconds = Math.floor(timeLeft % 60);
                    statusText = `🔒 Блок: ${minutes}м ${seconds}с`;
                    this.elements.statusText.style.color = '#F44336';
                }

                this.elements.statusText.textContent = statusText;
            });
        } catch (error) {
            console.error('Ошибка обновления статуса:', error);
        }
    }

    async navigateAndClosePopup(tabId) {
        try {
            // Активируем вкладку
            await chrome.tabs.update(tabId, { active: true });
            
            // Закрываем popup (автоматически после клика по ссылке на вкладку)
            window.close();
        } catch (error) {
            console.error('Ошибка навигации:', error);
        }
    }

    async closeTabAndRemove(tabId) {
        try {
            // Закрываем вкладку
            await chrome.tabs.remove(tabId);
            
            // Обновляем список
            this.fetchAndRender();
        } catch (error) {
            console.error('Ошибка закрытия вкладки:', error);
        }
    }
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    window.tabsManager = new TabsManager();
});