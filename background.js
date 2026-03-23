// background.js

const RULE_IDS = [1, 2]; // ID правил из rules.json

// --- НАСТРОЙКИ ---
const VIEW_TIME_SECONDS = 30 * 60;   
const COOLDOWN_TIME_SECONDS = 50 * 60; 

const ALARM_COOLDOWN_END = "cooldown_end";
const ALARM_UPDATE_BADGE = "update_badge_cooldown";

let lastTickTime = 0;

chrome.runtime.onInstalled.addListener(() => {
    resetToViewingState();
});

chrome.runtime.onStartup.addListener(() => {
    checkStateOnStartup();
});

// Ловим тики
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "tick") {
        const now = Date.now();
        if (now - lastTickTime >= 1000) {
            lastTickTime = now;
            processViewingTick();
        }
    }
});

function processViewingTick() {
    chrome.storage.local.get(['state', 'timeLeft'], (data) => {
        // Если уже блокировка - немедленно выкидываем пользователя
        if (data.state === 'COOLDOWN') {
            killYouTubeTabs(); 
            return;
        }

        let newTime = (data.timeLeft !== undefined) ? data.timeLeft : VIEW_TIME_SECONDS;
        newTime -= 1;

        if (newTime <= 0) {
            startCooldown();
        } else {
            chrome.storage.local.set({ timeLeft: newTime, state: 'VIEWING' });
            updateBadge(newTime, "green");
        }
    });
}

function startCooldown() {
    const unlockTime = Date.now() + (COOLDOWN_TIME_SECONDS * 1000);

    chrome.storage.local.set({
        state: 'COOLDOWN',
        unlockTime: unlockTime,
        timeLeft: 0
    });

    enableBlock();
    killYouTubeTabs(); // <--- ЖЁСТКИЙ СБРОС ТЕКУЩИХ ВКЛАДОК

    chrome.alarms.create(ALARM_COOLDOWN_END, { when: unlockTime });
    chrome.alarms.create(ALARM_UPDATE_BADGE, { periodInMinutes: 1 });

    updateBadge(COOLDOWN_TIME_SECONDS, "red");
}

/**
 * Переход в режим ПРОСМОТРА (Разблокировка)
 */
function resetToViewingState() {
    // Сначала снимаем блокировку сети
    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1, 2] // Указываем ID всех правил
    }, () => {
        // И только когда блокировка снята, меняем статус в хранилище
        // blocked.js увидит это изменение и сделает редирект
        chrome.storage.local.set({
            state: 'VIEWING',
            timeLeft: VIEW_TIME_SECONDS,
            unlockTime: null
        });
        
        chrome.alarms.clearAll();
        updateBadge(VIEW_TIME_SECONDS, "green");
    });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_COOLDOWN_END) {
        resetToViewingState();
    } else if (alarm.name === ALARM_UPDATE_BADGE) {
        chrome.storage.local.get(['unlockTime'], (data) => {
            if (data.unlockTime) {
                const msLeft = data.unlockTime - Date.now();
                if (msLeft > 0) {
                    updateBadge(Math.round(msLeft / 1000), "red");
                    // На всякий случай проверяем, не открыл ли пользователь вкладку во время бана
                    killYouTubeTabs(); 
                } else {
                    resetToViewingState();
                }
            }
        });
    }
});

// --- ЖЁСТКИЕ МЕТОДЫ ---

// Ищет все вкладки с YouTube и перенаправляет их на blocked.html
// background.js (только эта функция изменилась)

// background.js (обновленная функция)

// background.js (обновленная функция)

function killYouTubeTabs() {
    const blockedBaseUrl = chrome.runtime.getURL("blocked.html");
    
    chrome.tabs.query({url: ["*://*.youtube.com/*"]}, (tabs) => {
        tabs.forEach((tab) => {
            // Запрашиваем данные (время и заголовок)
            chrome.tabs.sendMessage(tab.id, { action: "getData" }, (response) => {
                
                const lastError = chrome.runtime.lastError; 
                let timestamp = 0;
                let videoTitle = "YouTube"; // Название по умолчанию

                if (!lastError && response) {
                    if (response.time) timestamp = response.time;
                    if (response.title) videoTitle = response.title;
                }

                // Чистим старую ссылку
                let originalUrl = tab.url;
                originalUrl = originalUrl.replace(/([&?]t=\d+s?)/g, '');

                // Добавляем таймкод
                const separator = originalUrl.includes('?') ? '&' : '?';
                const urlWithTime = `${originalUrl}${separator}t=${timestamp}s`;

                // СОБИРАЕМ ФИНАЛЬНУЮ ССЫЛКУ С НАЗВАНИЕМ
                // Мы кодируем title, чтобы спецсимволы не сломали ссылку
                const finalTargetUrl = `${blockedBaseUrl}?returnTo=${encodeURIComponent(urlWithTime)}&title=${encodeURIComponent(videoTitle)}`;
                
                chrome.tabs.update(tab.id, { url: finalTargetUrl });
            });
        });
    });
}

function enableBlock() {
    // Включаем правила блокировки сети
    chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [
            {
                "id": 1,
                "priority": 1,
                "action": { "type": "block" },
                "condition": {
                    "urlFilter": "||youtube.com",
                    "resourceTypes": ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]
                }
            },
            {
                "id": 2,
                "priority": 1,
                "action": { "type": "block" },
                "condition": {
                    "urlFilter": "||googlevideo.com",
                    "resourceTypes": ["media", "xmlhttprequest", "websocket", "other"]
                }
            }
        ]
    });
}

function removeBlock() {
    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: RULE_IDS
    });
}

function updateBadge(seconds, colorName) {
    const minutes = Math.ceil(seconds / 60);
    const colorHex = colorName === "green" ? "#4CAF50" : "#FF0000";
    chrome.action.setBadgeText({ text: `${minutes}m` });
    chrome.action.setBadgeBackgroundColor({ color: colorHex });
}

function checkStateOnStartup() {
    chrome.storage.local.get(['state', 'unlockTime'], (data) => {
        if (data.state === 'COOLDOWN' && data.unlockTime) {
            if (Date.now() > data.unlockTime) {
                resetToViewingState();
            } else {
                enableBlock();
                const msLeft = data.unlockTime - Date.now();
                updateBadge(Math.round(msLeft / 1000), "red");
                chrome.alarms.create(ALARM_COOLDOWN_END, { when: data.unlockTime });
                chrome.alarms.create(ALARM_UPDATE_BADGE, { periodInMinutes: 1 });
            }
        } else {
             removeBlock();
        }
    });
}