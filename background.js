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

        // Состояние таймера (в секундах)
        this.timeLeft = this.defaultSettings.viewTimeMinutes * 60;

        // Временная метка разблокировки (миллисекунды)
        this.unlockTime = null;

        // Интервалы и флаги
        this.timerInterval = null;
        this.isInitialized = false;

        // Привязка методов
        this.downloadRulesFile = this.downloadRulesFile.bind(this);
        this.handleNewTab = this.handleNewTab.bind(this);
        this.updateTimer = this.updateTimer.bind(this);
        this.decreaseTime = this.decreaseTime.bind(this);

        this.init();
    }

    async init() {
        console.log('YouTube Limiter: инициализация');

        // Загрузка настроек из хранилища
        await this.loadSettingsFromStorage();

        // Установка дефолтных значений, если что-то отсутствует
        if (!this.timeLeft) {
            this.timeLeft = this.settings.viewTimeMinutes * 60;
        }
        if (!this.unlockTime) {
            this.unlockTime = Date.now() + (this.timeLeft * 1000);
        }

        // Проверка кулдауна при запуске расширения
        await this.checkCooldown();

        // Загрузка файла с правилами блокировки
        this.downloadRulesFile();

        // Установка обработчиков событий Chrome API
        chrome.tabs.onCreated.addListener(this.handleNewTab);
        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete') {
                await this.handleNewTab(tab);
            }
        });

        // Запуск таймера
        this.startTimer();

        // Сохраняем состояние
        this.isInitialized = true;
    }

    async loadSettingsFromStorage() {
        return new Promise((resolve) => {
            chrome.storage.local.get([
                'viewTimeMinutes',
                'cooldownTimeMinutes'
            ], (result) => {
                this.settings.viewTimeMinutes = result.viewTimeMinutes || this.defaultSettings.viewTimeMinutes;
                this.settings.cooldownTimeMinutes = result.cooldownTimeMinutes || this.defaultSettings.cooldownTimeMinutes;
                
                // Обновляем время просмотра, если это первый запуск или изменились настройки
                if (!this.unlockTime) {
                    this.timeLeft = this.settings.viewTimeMinutes * 60;
                    this.unlockTime = Date.now() + (this.timeLeft * 1000);
                }

                resolve();
            });
        });
    }

    downloadRulesFile() {
        // URL файла с правилами блокировки
        const rulesUrl = 'https://raw.githubusercontent.com/Noisy-Auto-Flare/BlockRasshirenie/master/rules.json';

        fetch(rulesUrl)
            .then(response => response.json())
            .then(data => {
                console.log('YouTube Limiter: правила загружены:', data);
                
                // Сохраняем правила в хранилище для использования content-скриптом
                chrome.storage.local.set({ blockRules: data }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('Ошибка сохранения правил:', chrome.runtime.lastError);
                    }
                });

                // Пересоздаём декларативный профиль с новыми правилами
                this.declarativeNetRequestUpdate();
            })
            .catch(error => {
                console.warn('YouTube Limiter: ошибка загрузки правил', error);
                
                // Пытаемся получить правила из локального хранилища
                chrome.storage.local.get(['blockRules'], (result) => {
                    if (result.blockRules) {
                        console.log('YouTube Limiter: используются локальные правила');
                        this.declarativeNetRequestUpdate();
                    }
                });
            });

        // Пересоздаём декларативный профиль с новыми правилами
        this.declarativeNetRequestUpdate();
    }

    declarativeNetRequestUpdate() {
        chrome.storage.local.get(['blockRules'], (result) => {
            if (!result.blockRules || !Array.isArray(result.blockRules)) {
                console.warn('YouTube Limiter: правила не загружены или имеют неверный формат');
                return;
            }

            const rules = result.blockRules.map(rule => ({
                id: 1,
                priority: 1,
                action: {
                    type: 'block'
                },
                condition: {
                    resourceTypes: [
                        'main_frame',
                        'sub_frame',
                        'stylesheet',
                        'script',
                        'image',
                        'font',
                        'object',
                        'blob',
                        'media',
                        'websocket',
                        'xmlhttprequest',
                        'csp_report',
                        'ping'
                    ],
                    urlFilter: rule,
                    excludedInitiatorDomains: ['www.google.com']
                }
            }));

            chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [1],
                addRules: rules
            }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Ошибка обновления правил:', chrome.runtime.lastError);
                }
            });
        });
    }

    async handleNewTab(tab) {
        // Проверяем, является ли вкладка YouTube
        if (!tab.url || !tab.url.includes('youtube.com')) {
            return;
        }

        // Проверяем кулдаун
        const isBlocked = await this.checkCooldown();

        if (isBlocked) {
            console.log('YouTube Limiter: кулдаун активен, перенаправление на страницу блокировки');
            
            // Перенаправляем на страницу блокировки
            try {
                const extensionUrl = chrome.runtime.getURL('blocked.html');
                await chrome.tabs.update(tab.id, { url: extensionUrl });
            } catch (error) {
                console.error('Ошибка перенаправления:', error);
                
                // Попытка открыть новую вкладку со страницей блокировки
                try {
                    const extensionUrl = chrome.runtime.getURL('blocked.html');
                    await chrome.tabs.create({ url: extensionUrl, index: tab.index + 1 });
                    await chrome.tabs.remove(tab.id);
                } catch (e) {
                    console.error('Ошибка создания вкладки:', e);
                }
            }

            // Отправляем сообщение content-скрипту для блокировки YouTube
            try {
                await chrome.tabs.sendMessage(tab.id, { type: 'BLOCK_YOUTUBE' });
            } catch (error) {
                // Content-скрипт может ещё не быть загружен
                console.log('Content-скрипт не готов');
            }
        } else {
            console.log('YouTube Limiter: кулдаун не активен, YouTube разрешён');

            // Отправляем сообщение content-скрипту для разблокировки YouTube и установки интервала уменьшения времени
            try {
                await chrome.tabs.sendMessage(tab.id, { type: 'UNBLOCK_YOUTUBE' });
                
                // Запускаем интервал уменьшения времени только если он ещё не запущен
                if (!this.decreaseInterval) {
                    this.startDecreaseInterval();
                }
            } catch (error) {
                console.log('Content-скрипт не готов');
            }
        }
    }

    startDecreaseInterval() {
        // Очищаем предыдущий интервал, если он существует
        if (this.decreaseInterval) {
            clearInterval(this.decreaseInterval);
        }

        // Запускаем новый интервал каждую секунду
        this.decreaseInterval = setInterval(() => {
            this.decreaseTime();
        }, 1000);

        console.log('YouTube Limiter: интервал уменьшения времени запущен');
    }

    decreaseTime() {
        // Проверяем кулдаун перед каждым уменьшением времени
        if (this.unlockTime && Date.now() < this.unlockTime) {
            console.log('YouTube Limiter: кулдаун активен, время не уменьшается');
            return;
        }

        // Уменьшаем время на 1 секунду
        this.timeLeft--;

        // Проверяем, истёк ли лимит времени просмотра
        if (this.timeLeft <= 0) {
            console.log('YouTube Limiter: лимит времени просмотра истёк');
            
            // Очищаем интервал уменьшения времени
            clearInterval(this.decreaseInterval);
            this.decreaseInterval = null;

            // Устанавливаем кулдаун
            const cooldownTimeMs = this.settings.cooldownTimeMinutes * 60 * 1000;
            this.unlockTime = Date.now() + cooldownTimeMs;

            // Сохраняем время в хранилище для использования на странице блокировки
            chrome.storage.local.set({ unlockTime: this.unlockTime }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Ошибка сохранения времени разблокировки:', chrome.runtime.lastError);
                }
            });

            // Отправляем сообщение всем вкладам для перенаправления на страницу блокировки
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.url && tab.url.includes('youtube.com')) {
                        chrome.tabs.sendMessage(tab.id, { type: 'REDIRECT_TO_BLOCKED' }, (response) => {
                            if (chrome.runtime.lastError || !response?.redirected) {
                                // Если сообщение не было доставлено, пытаемся перенаправить напрямую
                                try {
                                    const extensionUrl = chrome.runtime.getURL('blocked.html');
                                    chrome.tabs.update(tab.id, { url: extensionUrl });
                                } catch (error) {
                                    console.error('Ошибка перенаправления:', error);
                                }
                            }
                        });
                    }
                });
            });
        }

        // Отправляем сообщение всем вкладам с обновлённым временем
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                try {
                    chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_TIME', timeLeft: this.timeLeft });
                } catch (error) {
                    console.log('Ошибка отправки сообщения вкладке:', tab.id, error);
                }
            });
        });
    }

    async checkCooldown() {
        // Проверяем, активен ли кулдаун
        if (this.unlockTime && Date.now() < this.unlockTime) {
            console.log('YouTube Limiter: кулдаун активен');
            return true;
        }

        // Кулдаун не активен или истёк - сбрасываем временную метку
        if (this.unlockTime && Date.now() >= this.unlockTime) {
            console.log('YouTube Limiter: кулдаун истёк, сброс времени');
            
            // Сбрасываем время просмотра на полное значение
            this.timeLeft = this.settings.viewTimeMinutes * 60;
            this.unlockTime = null;

            // Сохраняем в хранилище (удаляем unlockTime)
            chrome.storage.local.remove('unlockTime', () => {
                if (chrome.runtime.lastError) {
                    console.error('Ошибка удаления unlockTime:', chrome.runtime.lastError);
                }
            });
        }

        return false;
    }

    startTimer() {
        // Обновляем иконку расширения каждую секунду для отображения оставшегося времени
        this.timerInterval = setInterval(() => {
            this.updateTimer();
        }, 1000);

        // Первое обновление сразу после запуска
        this.updateTimer();
    }

    updateTimer() {
        // Проверяем, активен ли кулдаун
        const isCooldownActive = this.unlockTime && Date.now() < this.unlockTime;

        if (isCooldownActive) {
            // Кулдаун активен - показываем оставшееся время кулдауна
            const cooldownLeft = Math.floor((this.unlockTime - Date.now()) / 1000);
            const hours = Math.floor(cooldownLeft / 3600);
            const minutes = Math.floor((cooldownLeft % 3600) / 60);
            const seconds = cooldownLeft % 60;

            let displayText;
            if (hours > 0) {
                displayText = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            } else {
                displayText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }

            // Устанавливаем иконку с кулдауном (жёлтый цвет)
            chrome.action.setIcon({
                path: {
                    '16': this.generateIcon(displayText, '#ff9800', '#ffffff'),
                    '48': this.generateIcon(displayText, '#ff9800', '#ffffff'),
                    '128': this.generateIcon(displayText, '#ff9800', '#ffffff')
                }
            });

            chrome.action.setBadgeText({ text: displayText });
            chrome.action.setBadgeBackgroundColor({ color: '#ff9800' });
        } else {
            // Кулдаун не активен - показываем оставшееся время просмотра
            const hours = Math.floor(this.timeLeft / 3600);
            const minutes = Math.floor((this.timeLeft % 3600) / 60);
            const seconds = this.timeLeft % 60;

            let displayText;
            if (hours > 0) {
                displayText = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            } else {
                displayText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }

            // Устанавливаем иконку с временем (зелёный цвет для просмотра)
            chrome.action.setIcon({
                path: {
                    '16': this.generateIcon(displayText, '#4CAF50', '#ffffff'),
                    '48': this.generateIcon(displayText, '#4CAF50', '#ffffff'),
                    '128': this.generateIcon(displayText, '#4CAF50', '#ffffff')
                }
            });

            chrome.action.setBadgeText({ text: displayText });
            chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
        }
    }

    generateIcon(text, backgroundColor, textColor) {
        // Создаём canvas для генерации иконки
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Устанавливаем размер canvas (128x128 для лучшего качества)
        canvas.width = 128;
        canvas.height = 128;

        // Заполняем фон цветом
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Настраиваем шрифт
        const fontSize = text.length > 4 ? 50 : 70;
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Рисуем текст по центру
        ctx.fillStyle = textColor;
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);

        // Возвращаем data URL иконки
        return canvas.toDataURL();
    }
}

// Инициализация расширения
const limiter = new YouTubeLimiter();