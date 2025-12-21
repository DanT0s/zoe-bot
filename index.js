const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');

// Получаем ключи из настроек GitHub
const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ZOE_URL = "https://www.zoe.com.ua/wp-json/wp/v2/pages/371392";

// Список прокси (Ваши UA + Пустой для прямого соединения)
const PROXIES = [
    null, // Сначала пробуем НАПРЯМУЮ (Без прокси)
    'http://91.225.110.110:8080', // Ваши украинские прокси
    'http://193.25.121.222:80',
    'http://31.43.253.231:80',
    'http://176.101.220.90:8090',
    'socks4://46.98.193.59:5678'
];

const bot = new TelegramBot(TOKEN, { polling: false });

async function run() {
    console.log("🚀 Запуск бота...");
    let jsonString = null;

    // === ПЕРЕБОР ВАРИАНТОВ ПОДКЛЮЧЕНИЯ ===
    for (let proxy of PROXIES) {
        try {
            const label = proxy ? `UA Proxy ${proxy}` : "НАПРЯМУЮ (GitHub IP)";
            console.log(`🔄 Пробую: ${label}...`);

            const config = {
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
            };

            // Если есть прокси - добавляем агент
            if (proxy) {
                config.httpsAgent = new HttpsProxyAgent(proxy);
                config.proxy = false; // Отключаем стандартный axios proxy
            }

            const response = await axios.get(ZOE_URL + "?t=" + Date.now(), config);

            if (response.status === 200) {
                console.log("✅ УСПЕХ!");
                jsonString = JSON.stringify(response.data);
                break; // Получилось - выходим
            }
        } catch (e) {
            console.log(`❌ Неудачно: ${e.message}`);
        }
    }

    if (!jsonString) {
        console.log("💀 Все методы не сработали. Сайт лежит или блокирует всё.");
        return;
    }

    // === ОБРАБОТКА ДАННЫХ ===
    try {
        const jsonData = JSON.parse(jsonString);
        if (!jsonData.content || !jsonData.content.rendered) return;

        const rawHtml = jsonData.content.rendered;
        const plainText = convertHtmlToText(rawHtml);
        
        // Ваш фильтр: 1 блок + КАПС
        const cleanMessage = extractOneScheduleBlock(plainText);

        if (cleanMessage.length < 10) {
            console.log("График не найден в тексте.");
            return;
        }

        console.log("🔥 График получен. Отправляем в ТГ...");
        // Отправляем в Телеграм
        await bot.sendMessage(CHAT_ID, cleanMessage, { parse_mode: 'HTML', disable_web_page_preview: true });

    } catch (e) {
        console.error("Ошибка обработки:", e);
    }
}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
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
             if (bestHeader === "") bestHeader = line;
             else if (isUpperCase(line) && !isUpperCase(bestHeader)) bestHeader = line;
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
