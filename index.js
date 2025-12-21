const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ZOE_URL = "https://www.zoe.com.ua/wp-json/wp/v2/pages/371392";

// === ГІБРИДНИЙ СПИСОК (Веб-дзеркала + IP проксі) ===
const STRATEGIES = [
    // 1. WEB PROXY (Найбільш надійні для хмари)
    { type: 'web', url: `https://corsproxy.io/?${ZOE_URL}` },
    { type: 'web', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(ZOE_URL)}` },
    { type: 'web', url: `https://proxy.corsfix.com/?${ZOE_URL}`, headers: { 'Origin': 'http://localhost' } },
    
    // 2. ВАШІ IP ПРОКСІ (Сюди треба вставляти СВІЖІ)
    // Якщо старі не працюють - замініть їх новими з spys.one
    { type: 'ip', url: 'http://91.225.110.110:8080' }, 
    { type: 'ip', url: 'http://193.25.121.222:80' },
];

const bot = new TelegramBot(TOKEN, { polling: false });

async function run() {
    console.log("🚀 ЗАПУСК БОТА (HYBRID MODE)...");
    let jsonString = null;
    const timeParam = Date.now();

    for (let strategy of STRATEGIES) {
        try {
            console.log(`🔄 Пробую: ${strategy.type === 'web' ? 'WEB ' + strategy.url.substring(0, 30)+'...' : 'IP ' + strategy.url}...`);

            const config = {
                timeout: 8000, // Чекаємо 8 секунд
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
                    ...(strategy.headers || {}) // Додаємо спец. заголовки якщо треба
                }
            };

            let response;

            if (strategy.type === 'web') {
                // Для веб-проксі просто робимо запит на URL
                response = await axios.get(strategy.url + "&t=" + timeParam, config);
            } else {
                // Для IP проксі підключаємо агент
                config.httpsAgent = new HttpsProxyAgent(strategy.url);
                config.proxy = false;
                response = await axios.get(ZOE_URL + "?t=" + timeParam, config);
            }

            if (response.status === 200) {
                const data = response.data;
                // Перевірка, що прийшов не HTML-помилка, а дані
                let contentToCheck = typeof data === 'object' ? JSON.stringify(data) : data;
                
                if (contentToCheck.includes('content') && contentToCheck.includes('rendered')) {
                    console.log("✅ УСПІХ! Дані отримано.");
                    jsonString = contentToCheck;
                    break; // Виходимо з циклу
                }
            }
        } catch (e) {
            console.log(`❌ Невдача: ${e.message}`);
        }
    }

    if (!jsonString) {
        console.log("💀 Всі методи (Web та IP) не спрацювали.");
        return;
    }

    // === ОБРОБКА ===
    try {
        // Якщо прийшов JSON як рядок - парсимо
        const jsonData = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        
        let rawHtml = "";
        // Деякі проксі (AllOrigins) можуть повертати JSON у JSON
        if (jsonData.contents) {
             rawHtml = JSON.parse(jsonData.contents).content.rendered;
        } else {
             rawHtml = jsonData.content.rendered;
        }

        const plainText = convertHtmlToText(rawHtml);
        const cleanMessage = extractOneScheduleBlock(plainText);

        if (cleanMessage.length > 10) {
            console.log("🔥 Графік знайдено! Відправляю...");
            await bot.sendMessage(CHAT_ID, cleanMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
        } else {
            console.log("⚠️ Графік порожній.");
        }

    } catch (e) {
        console.error("Помилка парсингу:", e);
    }
}

// === УТИЛІТИ ===
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
        if (dateRegex.test(line) && (line.includes("ГПВ") || line.toUpperCase().includes("ОНОВЛЕНО") || line.toUpperCase().includes("ГРАФІК"))) {
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
