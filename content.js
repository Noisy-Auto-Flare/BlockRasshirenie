// content.js - Content-скрипт для взаимодействия со страницами YouTube

class YouTubeContentManager {
    constructor() {
        this.isYouTube = window.location.hostname.includes('youtube.com');
        
        if (!this.isYouTube) {
            return; // Скрипт работает только на YouTube
        }

        this.init();
    }

    init() {
        console.log('YouTube Limiter: Content-скрипт инициализирован');

        // Установка обработчика сообщений от service worker
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            return this.handleMessage(request, sender, sendResponse);
        });

        // Отслеживаем изменения видимости вкладки для корректной работы таймера
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('YouTube Limiter: вкладка стала активной');
            } else {
                console.log('YouTube Limiter: вкладка неактивна');
            }
        });

        // Периодическая проверка состояния блокировки (на случай изменений в background)
        setInterval(() => {
            this.checkBlockStatus();
        }, 5000);
    }

    async handleMessage(request, sender, sendResponse) {
        switch (request.type) {
            case 'UNBLOCK_YOUTUBE':
                // Разблокируем YouTube - ничего делать не нужно, страница уже загружается
                console.log('YouTube Limiter: разблокировка YouTube');
                
                // Запускаем интервал уменьшения времени через background.js
                chrome.runtime.sendMessage({ action: 'startDecreaseInterval' });

                sendResponse({ success: true });
                break;

            case 'BLOCK_YOUTUBE':
                // Блокируем YouTube - перенаправляем на страницу блокировки
                console.log('YouTube Limiter: блокировка YouTube');
                
                const extensionUrl = chrome.runtime.getURL('blocked.html');
                window.location.href = extensionUrl;
                
                sendResponse({ blocked: true });
                break;

            case 'REDIRECT_TO_BLOCKED':
                // Перенаправляем на страницу блокировки
                console.log('YouTube Limiter: перенаправление на страницу блокировки');
                
                const blockedUrl = chrome.runtime.getURL('blocked.html');
                window.location.href = blockedUrl;
                
                sendResponse({ redirected: true });
                break;

            case 'UPDATE_TIME':
                // Обновление времени - используем для отладки
                console.log('YouTube Limiter: время обновлено до', request.timeLeft, 'секунд');
                
                // Отправляем время обратно в background.js для уменьшения
                if (request.timeLeft > 0) {
                    chrome.runtime.sendMessage({ action: 'decreaseTime' });
                } else {
                    console.log('YouTube Limiter: лимит времени просмотра истёк');
                    
                    // Очищаем интервал уменьшения времени
                    clearInterval(this.decreaseInterval);

                    // Перенаправляем на страницу блокировки
                    const blockedUrl = chrome.runtime.getURL('blocked.html');
                    window.location.href = blockedUrl;
                }

                sendResponse({ updated: true });
                break;

            case 'GET_STATE':
                // Возвращаем текущее состояние страницы
                sendResponse({
                    url: window.location.href,
                    title: document.title,
                    isVideoPage: window.location.pathname.includes('/watch/')
                });
                break;
        }

        return true; // Для асинхронной отправки ответов
    }

    async checkBlockStatus() {
        // Проверяем состояние кулдауна каждые 5 секунд
        try {
            const data = await new Promise((resolve) => {
                chrome.storage.local.get(['unlockTime'], (result) => resolve(result));
            });

            if (data.unlockTime && Date.now() < data.unlockTime) {
                // Кулдаун активен, но мы всё ещё на YouTube - перенаправляем
                console.log('YouTube Limiter: обнаружен кулдаун, перенаправление');
                
                const blockedUrl = chrome.runtime.getURL('blocked.html');
                window.location.href = blockedUrl;
            }
        } catch (error) {
            console.error('Ошибка проверки состояния:', error);
        }
    }
}

// Инициализация
new YouTubeContentManager();