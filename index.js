const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ZOE_URL = "https://www.zoe.com.ua/wp-json/wp/v2/pages/371392";

const bot = new TelegramBot(TOKEN, { polling: false });

async function run() {
    console.log("🚀 Запуск бота через VPN...");
    
    try {
        // Запрос НАПРЯМУЮ (теперь это сработает, так как мы под VPN)
        const response = await axios.get(ZOE_URL + "?t=" + Date.now(), {
            timeout: 20000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' 
            }
        });

        if (response.status === 200) {
            console.log("✅ Сайт ZOE ответил!");
            
            const jsonData = response.data;
            if (!jsonData.content || !jsonData.content.rendered) return;

            const rawHtml = jsonData.content.rendered;
            const plainText = convertHtmlToText(rawHtml);
            const cleanMessage = extractOneScheduleBlock(plainText);

            if (cleanMessage.length > 10) {
                console.log("🔥 График получен. Отправляю...");
                // Можно добавить проверку хеша, чтобы не спамить, но пока шлем так
                await bot.sendMessage(CHAT_ID, cleanMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
            } else {
                console.log("⚠️ График не найден (пустой фильтр).");
            }
        }
    } catch (e) {
        console.log(`❌ Ошибка: ${e.message}`);
        if (e.response) console.log("Код ответа:", e.response.status);
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
