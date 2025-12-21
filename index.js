const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');

// Секреты из настроек GitHub
const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ZOE_URL = "https://www.zoe.com.ua/wp-json/wp/v2/pages/371392";

// === СПИСОК ВЕБ-ПРОКСИ (ЗЕРКАЛ) ===
// Мы пробуем их все по очереди. Хоть один должен пробить защиту.
const WEB_PROXIES = [
    `https://corsproxy.io/?${ZOE_URL}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(ZOE_URL)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(ZOE_URL)}`,
    `https://thingproxy.freeboard.io/fetch/${ZOE_URL}`,
    `https://proxy.corsfix.com/?${ZOE_URL}`,
    `https://api.chproxy.org/get?url=${encodeURIComponent(ZOE_URL)}` // Часто работает
];

const bot = new TelegramBot(TOKEN, { polling: false });

async function run() {
    console.log("🚀 ЗАПУСК ПРОВЕРКИ (5 МИНУТ)...");
    let jsonString = null;
    const timeParam = Date.now();

    // Перемешиваем прокси, чтобы не долбить всегда первый
    const shuffledProxies = WEB_PROXIES.sort(() => Math.random() - 0.5);

    for (let url of shuffledProxies) {
        try {
            // Добавляем анти-кеш
            const target = url.includes('?') ? `${url}&t=${timeParam}` : `${url}?t=${timeParam}`;
            console.log(`🔄 Пробую зеркало: ${target.substring(0, 40)}...`);

            const response = await axios.get(target, {
                timeout: 6000, // Ждем 6 секунд, если висит - идем дальше
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
                    'Origin': 'http://localhost' // Нужно для некоторых прокси
                }
            });

            if (response.status === 200) {
                const data = response.data;
                // Проверяем, что это тот самый JSON
                const contentStr = typeof data === 'object' ? JSON.stringify(data) : data;
                
                if (contentStr.includes('content') && contentStr.includes('rendered')) {
                    console.log("✅ УСПЕХ! Данные скачаны.");
                    jsonString = contentStr;
                    break; // Выходим из цикла, победа!
                }
            }
        } catch (e) {
            console.log(`⚠️ Не сработал: ${e.message}`);
        }
    }

    if (!jsonString) {
        console.log("💀 Все зеркала молчат или заблокированы.");
        return;
    }

    // === ПАРСИНГ ===
    try {
        const jsonData = JSON.parse(jsonString);
        let rawHtml = "";

        // Некоторые прокси (AllOrigins) возвращают JSON внутри JSON
        if (jsonData.contents) {
            try { rawHtml = JSON.parse(jsonData.contents).content.rendered; } catch(e) { rawHtml = jsonData.content.rendered; }
        } else {
            rawHtml = jsonData.content.rendered;
        }

        const plainText = convertHtmlToText(rawHtml);
        const cleanMessage = extractOneScheduleBlock(plainText);

        if (cleanMessage.length > 10) {
            // Чтобы не спамить каждые 5 минут одним и тем же, 
            // GitHub Actions сложно хранить состояние, но мы можем отправлять 
            // только если в заголовке есть "ОНОВЛЕНО" или просто слать всегда, 
            // а вы в ТГ выключите звук.
            
            // Но лучше всего - просто отправлять.
            console.log("🔥 График есть. Отправка...");
            await bot.sendMessage(CHAT_ID, cleanMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
        } else {
            console.log("⚠️ График не найден (пустой фильтр).");
        }

    } catch (e) {
        console.error("Ошибка обработки:", e);
    }
}

// === УТИЛИТЫ ===
function extractOneScheduleBlock(text) {
    const lines = text.split('\n');
    let bestHeader = ""; 
    let queueLines = [];
    let queuesFound = false; 
    const dateRegex = /(\d{1,2})\s+(СІЧНЯ|ЛЮТОГО|БЕРЕЗНЯ|КВІТНЯ|ТРАВНЯ|ЧЕРВНЯ|ЛИПНЯ|СЕРПНЯ|ВЕРЕСНЯ|ЖОВТНЯ|ЛИСТОПАДА|ГРУДНЯ)/i;
    const queueRegex = /^\s*\d\.\d\s*[:\.]/; 

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length < 3) continue;
        if (dateRegex.test(line) && (line.includes("ГПВ") || line.toUpperCase().includes("ОНОВЛЕНО") || line.toUpperCase().includes("ГРАФІК") || line.toUpperCase().includes("ДІЯТИМУТЬ"))) {
             if (line.includes("Орієнтовна схема")) continue;
             if (queuesFound) break; 
             if (bestHeader === "" || (isUpperCase(line) && !isUpperCase(bestHeader))) bestHeader = line;
        }
        if (queueRegex.test(line)) { queueLines.push(line); queuesFound = true; }
    }
    if (!bestHeader && queueLines.length > 0) bestHeader = "⚡️ <b>Графік відключень:</b>";
    else if (bestHeader) bestHeader = "⚡️ <b>" + bestHeader + "</b>";
    if (queueLines.length === 0) return "";
    return bestHeader + "\n\n" + queueLines.join('\n');
}

function isUpperCase(str) {
    const l = str.replace(/[^а-яА-Яa-zA-Z]/g, ""); 
    return l.length > 0 && (l.split('').filter(c => c === c.toUpperCase()).length / l.length) > 0.7;
}

function convertHtmlToText(html) {
    let t = html.replace(/<style([\s\S]*?)<\/style>/gi, "").replace(/<script([\s\S]*?)<\/script>/gi, "");
    t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n").replace(/<\/li>/gi, "\n");
    t = t.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&#8211;/g, "-").replace(/&#8217;/g, "'").replace(/&quot;/g, '"');
    return t.trim().replace(/\n\s*\n\s*\n/g, "\n\n");
}

run();
