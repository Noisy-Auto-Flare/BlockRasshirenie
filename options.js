// options.js - Логика страницы настроек с защитой от повторного редактирования

class OptionsManager {
    constructor() {
        // Элементы DOM
        this.elements = {
            form: document.getElementById('settings-form'),
            viewTimeInput: document.getElementById('view-time'),
            cooldownTimeInput: document.getElementById('cooldown-time'),
            lockTimeInput: document.getElementById('lock-time'),
            saveBtn: document.getElementById('save-btn'),
            currentState: document.getElementById('current-state'),
            timeLeftDisplay: document.getElementById('time-left-display'),
            lockIndicator: document.getElementById('lock-indicator'),
            lockStatus: document.getElementById('lock-status'),
            lockIcon: document.querySelector('.lock-icon'),
            timerDisplay: document.getElementById('timer-display'),
            lockTimerValue: document.getElementById('lock-timer-value'),
            notification: document.getElementById('notification')
        };

        // Состояние
        this.settings = {
            viewTimeMinutes: 30,
            cooldownTimeMinutes: 60,
            lockTimeMinutes: 5
        };
        
        this.state = null;
        this.timeLeft = 0;
        this.unlockTime = null;
        this.lockUntil = null;

        // Привязка методов
        this.handleFormSubmit = this.handleFormSubmit.bind(this);
        this.updateUI = this.updateUI.bind(this);
        this.updateTimer = this.updateTimer.bind(this);

        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.updateUI();
        
        // Запуск таймеров обновления
        setInterval(this.updateTimer, 1000); // Таймер блокировки настроек
        setInterval(() => this.loadAndDisplayState(), 2000); // Обновление состояния (не чаще)
    }

    async loadData() {
        try {
            const result = await new Promise((resolve) => {
                chrome.storage.local.get([
                    'viewTimeMinutes',
                    'cooldownTimeMinutes', 
                    'lockTimeMinutes',
                    'state',
                    'timeLeft',
                    'unlockTime',
                    'lockUntil'
                ], (data) => resolve(data));
            });

            // Загружаем настройки с проверкой границ
            this.settings.viewTimeMinutes = this.clamp(
                result.viewTimeMinutes || 30, 1, 180
            );
            this.settings.cooldownTimeMinutes = this.clamp(
                result.cooldownTimeMinutes || 60, 1, 600
            );
            this.settings.lockTimeMinutes = this.clamp(
                result.lockTimeMinutes || 5, 1, 60
            );

            // Загружаем состояние и временные метки
            this.state = result.state || 'VIEWING';
            this.timeLeft = result.timeLeft || this.settings.viewTimeMinutes * 60;
            this.unlockTime = result.unlockTime || null;
            this.lockUntil = result.lockUntil || null;

        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
            this.showNotification('Ошибка загрузки настроек', 'error');
        }
    }

    async loadAndDisplayState() {
        try {
            const result = await new Promise((resolve) => {
                chrome.storage.local.get(['state', 'timeLeft'], (data) => resolve(data));
            });

            this.state = result.state || 'VIEWING';
            this.timeLeft = result.timeLeft !== undefined ? result.timeLeft : 0;
            
            this.updateStatusCard();
        } catch (error) {
            console.error('Ошибка обновления состояния:', error);
        }
    }

    setupEventListeners() {
        this.elements.form.addEventListener('submit', this.handleFormSubmit);
        
        // Слушаем изменения в настройках для валидации
        [this.elements.viewTimeInput, this.elements.cooldownTimeInput, this.elements.lockTimeInput]
            .forEach(input => {
                input.addEventListener('input', () => this.validateInputs());
                input.addEventListener('focus', () => this.validateInputs());
            });
    }

    handleFormSubmit(event) {
        event.preventDefault();
        
        // Получаем значения из формы
        const viewTime = parseInt(this.elements.viewTimeInput.value);
        const cooldownTime = parseInt(this.elements.cooldownTimeInput.value);
        const lockTime = parseInt(this.elements.lockTimeInput.value);

        // Валидация
        if (!this.isValidValue(viewTime, 1, 180) || 
            !this.isValidValue(cooldownTime, 1, 600) || 
            !this.isValidValue(lockTime, 1, 60)) {
            this.showNotification('Проверьте значения полей', 'error');
            return;
        }

        // Сохраняем настройки
        const newData = {
            viewTimeMinutes: viewTime,
            cooldownTimeMinutes: cooldownTime,
            lockTimeMinutes: lockTime,
            lockUntil: Date.now() + (lockTime * 60 * 1000) // Устанавливаем блокировку
        };

        chrome.storage.local.set(newData, () => {
            if (chrome.runtime.lastError) {
                this.showNotification('Ошибка сохранения', 'error');
                return;
            }

            // Обновляем локальное состояние
            this.settings.viewTimeMinutes = viewTime;
            this.settings.cooldownTimeMinutes = cooldownTime;
            this.settings.lockTimeMinutes = lockTime;
            this.lockUntil = newData.lockUntil;

            // Уведомление об успехе
            this.showNotification(
                `Настройки сохранены! Блокировка на ${lockTime} мин.`, 
                'success'
            );

            // Обновляем UI
            this.updateUI();
        });
    }

    updateUI() {
        // Устанавливаем значения в поля
        this.elements.viewTimeInput.value = this.settings.viewTimeMinutes;
        this.elements.cooldownTimeInput.value = this.settings.cooldownTimeMinutes;
        this.elements.lockTimeInput.value = this.settings.lockTimeMinutes;

        // Проверяем, заблокированы ли настройки
        const isLocked = this.lockUntil && Date.now() < this.lockUntil;
        
        if (isLocked) {
            this.disableSettings(true);
            this.startLockTimer();
        } else {
            this.disableSettings(false);
            this.elements.timerDisplay.classList.remove('active');
        }

        this.updateStatusCard();
        this.validateInputs();
    }

    disableSettings(disabled) {
        this.elements.viewTimeInput.disabled = disabled;
        this.elements.cooldownTimeInput.disabled = disabled;
        this.elements.lockTimeInput.disabled = disabled;
        
        if (disabled) {
            this.elements.lockIndicator.classList.add('locked');
            this.elements.lockIcon.textContent = '🔒';
            this.elements.lockStatus.textContent = 'Блокировано после сохранения';
            this.elements.timerDisplay.classList.add('active');
        } else {
            this.elements.lockIndicator.classList.remove('locked');
            this.elements.lockIcon.textContent = '🔓';
            this.elements.lockStatus.textContent = 'Редактирование доступно';
            this.elements.timerDisplay.classList.remove('active');
        }
    }

    startLockTimer() {
        const updateLockTimeDisplay = () => {
            if (!this.lockUntil || Date.now() >= this.lockUntil) {
                // Блокировка истекла - разблокируем
                chrome.storage.local.get(['lockUntil'], (data) => {
                    if (data.lockUntil && Date.now() >= data.lockUntil) {
                        this.lockUntil = null;
                        this.disableSettings(false);
                    }
                });
                return;
            }

            const msLeft = this.lockUntil - Date.now();
            const minutes = Math.floor(msLeft / 60000);
            const seconds = Math.floor((msLeft % 60000) / 1000);
            
            this.elements.lockTimerValue.textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };

        updateLockTimeDisplay();
        setInterval(updateLockTimeDisplay, 1000);
    }

    updateStatusCard() {
        // Обновляем отображение текущего состояния
        if (this.state === 'VIEWING') {
            this.elements.currentState.textContent = '🟢 ПРОСМОТР';
            this.elements.currentState.style.color = '#4CAF50';
        } else if (this.state === 'COOLDOWN') {
            this.elements.currentState.textContent = '🔴 КУЛДАУН';
            this.elements.currentState.style.color = '#ff0000';
        } else {
            this.elements.currentState.textContent = '—';
            this.elements.currentState.style.color = '#ffffff';
        }

        // Форматируем время
        const minutes = Math.floor(this.timeLeft / 60);
        const seconds = Math.floor(this.timeLeft % 60);
        this.elements.timeLeftDisplay.textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    updateTimer() {
        // Обновление таймера блокировки настроек
        if (this.lockUntil && Date.now() < this.lockUntil) {
            const msLeft = this.lockUntil - Date.now();
            const minutes = Math.floor(msLeft / 60000);
            const seconds = Math.floor((msLeft % 60000) / 1000);
            
            this.elements.lockTimerValue.textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    validateInputs() {
        const viewTimeValid = this.isValidValue(
            parseInt(this.elements.viewTimeInput.value), 1, 180
        );
        const cooldownTimeValid = this.isValidValue(
            parseInt(this.elements.cooldownTimeInput.value), 1, 600
        );
        const lockTimeValid = this.isValidValue(
            parseInt(this.elements.lockTimeInput.value), 1, 60
        );

        // Активируем кнопку сохранения только если все валидно и не заблокировано
        const isLocked = this.lockUntil && Date.now() < this.lockUntil;
        this.elements.saveBtn.disabled = 
            !(viewTimeValid && cooldownTimeValid && lockTimeValid) || isLocked;
    }

    isValidValue(value, min, max) {
        return !isNaN(value) && value >= min && value <= max;
    }

    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    showNotification(message, type = 'success') {
        const notification = this.elements.notification;
        
        notification.textContent = message;
        notification.className = `notification ${type} show`;
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    window.optionsManager = new OptionsManager();
});