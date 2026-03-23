// content.js - Content-скрипт для взаимодействия со страницами YouTube

class YouTubeContentManager {
    constructor() {
        this.isYouTube = window.location.hostname.includes('youtube.com');
        
        if (!this.isYouTube) {
            return;
        }

        this.timerElement = null;
        this.init();
    }

    init() {
        console.log('YouTube Limiter: Content-скрипт инициализирован');

        // Создаем элемент таймера
        this.createTimerUI();

        // Проверяем состояние при загрузке
        this.updateState();

        // Периодическая проверка состояния блокировки и обновление таймера
        setInterval(() => {
            this.updateState();
        }, 1000);
    }

    createTimerUI() {
        if (this.timerElement) return;

        this.timerElement = document.createElement('div');
        this.timerElement.id = 'yt-limiter-timer';
        this.timerElement.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 8px 12px;
            border-radius: 20px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            z-index: 999999;
            pointer-events: none;
            transition: opacity 0.3s;
            display: none;
        `;
        document.body.appendChild(this.timerElement);
    }

    async updateState() {
        try {
            chrome.runtime.sendMessage({ action: 'getTimerState' }, (response) => {
                if (chrome.runtime.lastError || !response) {
                    if (this.timerElement) this.timerElement.style.display = 'none';
                    return;
                }
                
                if (response.state === 'COOLDOWN') {
                    const blockedUrl = chrome.runtime.getURL('blocked.html');
                    if (window.location.href !== blockedUrl) {
                        window.location.href = blockedUrl;
                    }
                } else if (response.state === 'VIEWING') {
                    if (this.timerElement) {
                        const minutes = Math.floor(response.timeLeft / 60);
                        const seconds = response.timeLeft % 60;
                        this.timerElement.textContent = `⏳ ${minutes}м ${seconds}с`;
                        this.timerElement.style.display = 'block';
                        
                        // Если времени мало, подсвечиваем красным
                        if (response.timeLeft < 60) {
                            this.timerElement.style.background = 'rgba(244, 67, 54, 0.8)';
                        } else {
                            this.timerElement.style.background = 'rgba(0, 0, 0, 0.7)';
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Ошибка обновления состояния:', error);
        }
    }
}

// Инициализация
new YouTubeContentManager();