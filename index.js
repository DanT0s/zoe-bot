const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ZOE_URL = "https://www.zoe.com.ua/wp-json/wp/v2/pages/371392";
const HASH_FILE = 'last_hash.txt';

// ПРОВЕРКА КАЖДЫЕ 3 МИНУТЫ (180000 мс)
const CHECK_INTERVAL = 180000;

const bot = new TelegramBot(TOKEN, { polling: false });
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Переменная для хранения последнего хеша в памяти
let memoryHash = '';

async function startLoop() {
    console.log("🚀 ЗАПУСК МАРАФОНА (проверка каждые 3 мин)...");

    // 1. При старте пытаемся вспомнить, что было в прошлой смене (из файла)
    if (fs.existsSync(HASH_FILE)) {
        memoryHash = fs.readFileSync(HASH_FILE, 'utf8').trim();
        console.log(`📂 Восстановлена память: ${memoryHash}`);
    }

    // БЕСКОНЕЧНЫЙ ЦИКЛ
    while (true) {
        await checkSchedule();
        
        console.log(`⏳ Жду 3 минуты...`);
        await wait(CHECK_INTERVAL);
    }
}

async function checkSchedule() {
    const timeLabel = new Date().toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kiev' });
    console.log(`[${timeLabel}] 🔄 Проверка сайта...`);
    
    try {
        const response = await axios.get(ZOE_URL + "?t=" + Date.now(), {
            timeout: 30000,
            httpsAgent: httpsAgent,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
        });

        if (response.status === 200) {
            const jsonData = response.data;
            if (!jsonData.content || !jsonData.content.rendered) return;

            const plainText = convertHtmlToText(jsonData.content.rendered);
            const cleanMessage = extractOneScheduleBlock(plainText);

            if (cleanMessage.length > 10) {
                // Создаем "отпечаток" (удаляем пробелы, чтобы исключить ложные срабатывания)
                const normalizedText = cleanMessage.replace(/\s+/g, '').trim();
                const currentHash = crypto.createHash('md5').update(normalizedText).digest('hex');

                // СРАВНИВАЕМ
                if (currentHash !== memoryHash) {
                    console.log("🔥 НОВЫЙ ГРАФИК! Отправляю...");
                    
                    await bot.sendMessage(CHAT_ID, cleanMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
                    
                    // Обновляем память
                    memoryHash = currentHash;
                    // И сохраняем в файл (для следующей смены через 5 часов)
                    fs.writeFileSync(HASH_FILE, currentHash);
                } else {
                    console.log("💤 Изменений нет. Молчу.");
                }
            }
        }
    } catch (e) {
        console.log(`❌ Ошибка запроса: ${e.message}`);
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

startLoop();
