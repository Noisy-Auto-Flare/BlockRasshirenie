// content.js

// Таймер
setInterval(() => {
    if (document.visibilityState === 'visible') {
        chrome.runtime.sendMessage({ action: "tick" });
    }
}, 1000);

// Обработчик запроса данных
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getData") { // Переименовали действие в более общее
        const video = document.querySelector('video');
        const time = video ? Math.floor(video.currentTime) : 0;
        
        // Отправляем время И название
        sendResponse({ 
            time: time,
            title: document.title 
        });
    }
    return true;
});