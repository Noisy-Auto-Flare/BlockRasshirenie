// blocked.js - Логика заблокированной страницы с правильным таймером

class BlockedPage {
    constructor() {
        this.timerElement = document.getElementById('timer');
        this.progressFill = document.getElementById('progress-fill');
        
        this.unlockTime = null;
        this.totalDuration = 0;
        
        // Привязка методов
        this.updateTimerDisplay = this.updateTimerDisplay.bind(this);

        this.init();
    }

    async init() {
        await this.loadUnlockTime();
    }

    async loadUnlockTime() {
        try {
            chrome.runtime.sendMessage({ action: 'getTimerState' }, (response) => {
                if (chrome.runtime.lastError || !response) {
                    this.redirectToYouTube();
                    return;
                }

                if (response.state === 'COOLDOWN' && response.unlockTime && Date.now() < response.unlockTime) {
                    this.unlockTime = parseInt(response.unlockTime);
                    // Общая длительность кулдауна (для прогресс-бара)
                    chrome.storage.local.get(['cooldownTimeMinutes'], (data) => {
                        const cooldownMinutes = data.cooldownTimeMinutes || 60;
                        this.totalDuration = cooldownMinutes * 60 * 1000;
                        this.startTimer();
                    });
                } else {
                    this.redirectToYouTube();
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки unlockTime:', error);
            this.redirectToYouTube();
        }
    }

    startTimer() {
        // Обновляем таймер каждую секунду
        const timerInterval = setInterval(() => {
            if (!this.unlockTime || Date.now() >= this.unlockTime) {
                clearInterval(timerInterval);
                this.redirectToYouTube();
                return;
            }

            const remainingMs = this.unlockTime - Date.now();
            this.updateTimerDisplay(remainingMs);

        }, 1000);

        // Первое обновление сразу
        const remainingMs = this.unlockTime - Date.now();
        this.updateTimerDisplay(remainingMs);
    }

    updateTimerDisplay(ms) {
        if (ms <= 0) {
            ms = 0;
        }

        // Переводим миллисекунды в часы, минуты и секунды
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);

        // Форматируем отображение
        let displayText;
        if (hours > 0) {
            displayText = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            displayText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }

        this.timerElement.textContent = displayText;

        // Обновляем прогресс-бар
        const progressPercent = ((this.totalDuration - ms) / this.totalDuration) * 100;
        this.progressFill.style.width = `${progressPercent}%`;

        // Меняем стиль таймера в зависимости от оставшегося времени
        this.timerElement.className = 'timer';
        if (ms < 60000) {
            // Менее минуты - danger состояние
            this.timerElement.classList.add('danger');
        } else if (ms < 300000) {
            // Менее 5 минут - warning состояние
            this.timerElement.classList.add('warning');
        }
    }

    async checkAndRedirect() {
        try {
            const data = await new Promise((resolve) => {
                chrome.storage.local.get(['unlockTime'], (result) => resolve(result));
            });

            if (!data.unlockTime || Date.now() >= data.unlockTime) {
                this.redirectToYouTube();
            }
        } catch (error) {
            console.error('Ошибка проверки:', error);
        }
    }

    redirectToYouTube() {
        // Получаем последнюю открытую YouTube вкладку или создаем новую
        chrome.tabs.query({ url: '*youtube.com*' }, (tabs) => {
            if (tabs.length > 0) {
                // Переходим на первую найденную YouTube вкладку
                chrome.tabs.update(tabs[0].id, { active: true });
            } else {
                // Создаем новую вкладку с YouTube
                chrome.tabs.create({ url: 'https://www.youtube.com' });
            }
        });
    }
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    window.blockedPage = new BlockedPage();
});