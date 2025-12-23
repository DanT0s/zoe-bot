const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const https = require('https');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ZOE_URL = "https://www.zoe.com.ua/wp-json/wp/v2/pages/371392";
const SAVE_FILE = 'last_header.txt'; 

// ПЕРЕВІРКА: Кожні 3 хвилини
const CHECK_INTERVAL = 120000; 

// РОБОЧИЙ ЧАС: 4 години 50 хвилин (залишаємо час на перезавантаження)
const WORK_DURATION = (4 * 60 * 60 * 1000) + (50 * 60 * 1000);

const bot = new TelegramBot(TOKEN, { polling: false });
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let lastKnownHeader = '';

async function startLoop() {
    console.log("🚀 ЗАПУСК СМЕНЫ (4 години 50 хвилин)...");
    const startTime = Date.now();

    // 1. Читаємо файл прямо з папки (тепер він частина репозиторію)
    if (fs.existsSync(SAVE_FILE)) {
        lastKnownHeader = fs.readFileSync(SAVE_FILE, 'utf8').trim();
        console.log(`📂 З пам'яті завантажено: "${lastKnownHeader}"`);
    } else {
        console.log("📂 Файл пам'яті відсутній. Створюю новий.");
    }

    // ЦИКЛ
    while (true) {
        // Якщо час вийшов - виходимо
        if (Date.now() - startTime > WORK_DURATION) {
            console.log("🛑 Час зміни вийшов. Завершую роботу для збереження даних...");
            break; 
        }

        await checkSchedule();
        
        console.log(`⏳ Чекаю 3 хвилини...`);
        await wait(CHECK_INTERVAL);
    }
}

async function checkSchedule() {
    const timeLabel = new Date().toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kiev' });
    console.log(`[${timeLabel}] 🔄 Перевірка...`);
    
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
                const currentHeader = cleanMessage.split('\n')[0].trim();

                // ПОРІВНЯННЯ
                if (normalize(currentHeader) !== normalize(lastKnownHeader)) {
                    console.log(`🔥 НОВИЙ ЗАГОЛОВОК! \nБуло: "${lastKnownHeader}"\nСтало: "${currentHeader}"`);
                    
                    await bot.sendMessage(CHAT_ID, cleanMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
                    
                    lastKnownHeader = currentHeader;
                    // Одразу пишемо на диск
                    fs.writeFileSync(SAVE_FILE, currentHeader); 
                } else {
                    console.log("💤 Заголовок без змін.");
                }
            }
        }
    } catch (e) {
        console.log(`❌ Помилка: ${e.message}`);
    }
}

function normalize(text) {
    return text.replace(/[^a-zA-Zа-яА-Я0-9]/g, '').toLowerCase();
}

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
