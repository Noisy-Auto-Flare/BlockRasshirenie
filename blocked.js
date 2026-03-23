// blocked.js

const params = new URLSearchParams(window.location.search);
const returnUrl = params.get('returnTo');
// Получаем заголовок и декодируем его
const videoTitle = params.get('title'); 

let isWaitingForFocus = false;

// СРАЗУ ЖЕ УСТАНАВЛИВАЕМ НАЗВАНИЕ ВКЛАДКИ
if (videoTitle && videoTitle !== "undefined") {
    document.title = "⏸️ " + videoTitle;
} else {
    document.title = "⏸️ YouTube (Пауза)";
}

function updateTimer() {
    chrome.storage.local.get(['state', 'unlockTime'], (data) => {
        
        const timerElement = document.getElementById('timer');
        const statusElement = document.getElementById('status-text');
        const titleElement = document.getElementById('video-title-display'); // Элемент для отображения названия на странице

        // Отображаем название и на самой черной странице (для красоты)
        if (titleElement && videoTitle) {
            titleElement.innerText = videoTitle;
        }

        // --- ЛОГИКА РАЗБЛОКИРОВКИ ---
        if (data.state === 'VIEWING') {
            if (document.visibilityState === 'visible') {
                performRedirect(statusElement);
            } else {
                if (!isWaitingForFocus) {
                    isWaitingForFocus = true;
                    timerElement.innerText = "ГОТОВО";
                    statusElement.innerText = "Кликните для просмотра";
                    // Меняем заголовок вкладки на призывающий
                    document.title = "▶️ ЖМИТЕ СЮДА! " + (videoTitle || "");
                    
                    document.addEventListener("visibilitychange", () => {
                        if (document.visibilityState === 'visible') {
                            performRedirect(statusElement);
                        }
                    }, { once: true });
                }
            }
            return;
        }

        // --- ЛОГИКА ТАЙМЕРА ---
        if (data.unlockTime) {
            const now = Date.now();
            const msLeft = data.unlockTime - now;

            if (msLeft > 0) {
                const minutes = Math.floor(msLeft / 60000);
                const seconds = Math.floor((msLeft % 60000) / 1000);
                timerElement.innerText = `${minutes}м ${seconds < 10 ? '0' : ''}${seconds}с`;
            } else {
                timerElement.innerText = "00м 00с";
            }
        }
    });
}

function performRedirect(element) {
    element.innerText = "Запуск...";
    if (returnUrl && returnUrl !== "undefined" && returnUrl !== "null") {
        window.location.href = decodeURIComponent(returnUrl);
    } else {
        window.location.href = "https://www.youtube.com";
    }
}

setInterval(updateTimer, 1000);
document.addEventListener('DOMContentLoaded', updateTimer);