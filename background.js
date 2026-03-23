// background.js - Сервис-воркер расширения для ограничения просмотра YouTube

class YouTubeLimiter {
    constructor() {
        // Конфигурация по умолчанию
        this.defaultSettings = {
            viewTimeMinutes: 30,
            cooldownTimeMinutes: 60,
            lockTimeMinutes: 5
        };

        // Текущие настройки
        this.settings = { ...this.defaultSettings };

        // Состояние (в секундах)
        this.timeLeft = this.defaultSettings.viewTimeMinutes * 60;
        this.state = 'VIEWING'; // 'VIEWING' или 'COOLDOWN'

        // Временная метка разблокировки (миллисекунды)
        this.unlockTime = null;

        // Интервалы
        this.mainInterval = null;
        this.isInitialized = false;

        this.init();
    }

    async init() {
        console.log('YouTube Limiter: инициализация');

        // Загрузка настроек и состояния из хранилища
        await this.loadStateFromStorage();

        // Проверка кулдауна при запуске
        await this.checkCooldown();

        // Загрузка файла с правилами блокировки
        this.downloadRulesFile();

        // Установка обработчиков событий Chrome API
        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url && tab.url.includes('youtube.com')) {
                await this.handleYouTubeTab(tab);
            }
        });

        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (tab.url && tab.url.includes('youtube.com')) {
                await this.handleYouTubeTab(tab);
            }
        });

        // Слушаем сообщения от других частей расширения
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'getTimerState') {
                sendResponse({
                    timeLeft: this.timeLeft,
                    state: this.state,
                    unlockTime: this.unlockTime
                });
            } else if (message.action === 'updateSettings') {
                this.loadStateFromStorage();
            }
            return true;
        });

        // Запуск основного цикла (1 раз в секунду)
        this.startMainLoop();

        this.isInitialized = true;
    }

    async loadStateFromStorage() {
        return new Promise((resolve) => {
            chrome.storage.local.get([
                'viewTimeMinutes',
                'cooldownTimeMinutes',
                'timeLeft',
                'state',
                'unlockTime'
            ], (result) => {
                this.settings.viewTimeMinutes = result.viewTimeMinutes || this.defaultSettings.viewTimeMinutes;
                this.settings.cooldownTimeMinutes = result.cooldownTimeMinutes || this.defaultSettings.cooldownTimeMinutes;
                
                this.state = result.state || 'VIEWING';
                
                if (result.timeLeft !== undefined) {
                    this.timeLeft = result.timeLeft;
                } else {
                    this.timeLeft = this.settings.viewTimeMinutes * 60;
                }

                this.unlockTime = result.unlockTime || null;
                resolve();
            });
        });
    }

    async saveStateToStorage() {
        await chrome.storage.local.set({
            timeLeft: this.timeLeft,
            state: this.state,
            unlockTime: this.unlockTime
        });
    }

    downloadRulesFile() {
        const rulesUrl = 'https://raw.githubusercontent.com/Noisy-Auto-Flare/BlockRasshirenie/master/rules.json';

        fetch(rulesUrl)
            .then(response => response.json())
            .then(data => {
                chrome.storage.local.set({ blockRules: data }, () => {
                    this.updateBlockingRules();
                });
            })
            .catch(error => {
                console.warn('YouTube Limiter: ошибка загрузки правил, используем локальные');
                this.updateBlockingRules();
            });
    }

    async updateBlockingRules() {
        let result = await chrome.storage.local.get(['blockRules']);
        let ruleData = result.blockRules;
        
        // Если в хранилище пусто, пробуем загрузить из локального файла
        if (!ruleData) {
            try {
                const response = await fetch(chrome.runtime.getURL('rules.json'));
                ruleData = await response.json();
                await chrome.storage.local.set({ blockRules: ruleData });
            } catch (e) {
                console.warn('YouTube Limiter: не удалось загрузить локальный rules.json');
            }
        }
        
        // Очищаем старые правила
        const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
        const oldIds = oldRules.map(r => r.id);

        let newRules = [];
        if (this.state === 'COOLDOWN') {
            if (Array.isArray(ruleData)) {
                newRules = ruleData.map((rule, index) => {
                    if (typeof rule === 'string') {
                        return {
                            id: index + 1,
                            priority: 1,
                            action: { type: 'block' },
                            condition: {
                                urlFilter: rule,
                                resourceTypes: ['main_frame', 'sub_frame']
                            }
                        };
                    }
                    return {
                        ...rule,
                        id: index + 1
                    };
                });
            } else {
                newRules = [{
                    id: 1,
                    priority: 1,
                    action: { type: 'block' },
                    condition: {
                        urlFilter: '||youtube.com',
                        resourceTypes: ['main_frame', 'sub_frame']
                    }
                }];
            }
        }

        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: oldIds,
            addRules: newRules
        });
    }

    async handleYouTubeTab(tab) {
        if (this.state === 'COOLDOWN') {
            const blockedUrl = chrome.runtime.getURL('blocked.html');
            if (tab.url !== blockedUrl) {
                chrome.tabs.update(tab.id, { url: blockedUrl });
            }
        }
    }

    startMainLoop() {
        if (this.mainInterval) clearInterval(this.mainInterval);
        this.mainInterval = setInterval(() => this.tick(), 1000);
    }

    async tick() {
        if (this.state === 'COOLDOWN') {
            const now = Date.now();
            if (now >= this.unlockTime) {
                // Кулдаун завершен
                this.state = 'VIEWING';
                this.timeLeft = this.settings.viewTimeMinutes * 60;
                this.unlockTime = null;
                await this.updateBlockingRules();
                await this.saveStateToStorage();
            } else {
                // Кулдаун продолжается
                this.timeLeft = Math.ceil((this.unlockTime - now) / 1000);
                // Периодически сохраняем, чтобы popup видел актуальное время
                if (this.timeLeft % 5 === 0) await this.saveStateToStorage();
            }
        } else {
            // Режим просмотра - проверяем, есть ли активные вкладки YouTube
            const youtubeTabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
            const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            
            const isYouTubeActive = activeTabs.some(tab => tab.url && tab.url.includes('youtube.com'));

            if (isYouTubeActive && youtubeTabs.length > 0) {
                this.timeLeft--;
                if (this.timeLeft <= 0) {
                    // Время вышло, включаем кулдаун
                    this.state = 'COOLDOWN';
                    this.unlockTime = Date.now() + (this.settings.cooldownTimeMinutes * 60 * 1000);
                    this.timeLeft = this.settings.cooldownTimeMinutes * 60;
                    
                    await this.updateBlockingRules();
                    await this.saveStateToStorage();
                    this.redirectAllYouTubeTabs();
                } else {
                    // Просто уменьшаем время
                    if (this.timeLeft % 5 === 0) await this.saveStateToStorage();
                }
            }
        }

        this.updateBadge();
    }

    async redirectAllYouTubeTabs() {
        const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
        const blockedUrl = chrome.runtime.getURL('blocked.html');
        for (const tab of tabs) {
            chrome.tabs.update(tab.id, { url: blockedUrl });
        }
    }

    updateBadge() {
        const minutes = Math.floor(this.timeLeft / 60);
        const seconds = this.timeLeft % 60;
        const text = minutes > 0 ? `${minutes}m` : `${seconds}s`;
        
        chrome.action.setBadgeText({ text: text });
        chrome.action.setBadgeBackgroundColor({ 
            color: this.state === 'COOLDOWN' ? '#F44336' : '#4CAF50' 
        });
    }

    async checkCooldown() {
        if (this.unlockTime && Date.now() < this.unlockTime) {
            this.state = 'COOLDOWN';
        } else if (this.state === 'COOLDOWN') {
            this.state = 'VIEWING';
            this.timeLeft = this.settings.viewTimeMinutes * 60;
            this.unlockTime = null;
        }
        await this.updateBlockingRules();
    }
}

// Инициализация
const limiter = new YouTubeLimiter();