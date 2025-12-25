const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const https = require('https');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ZOE_PAGE_URL = "https://www.zoe.com.ua/%D0%B3%D1%80%D0%B0%D1%84%D1%96%D0%BA%D0%B8-%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B8%D0%BD%D0%BD%D0%B8%D1%85-%D1%81%D1%82%D0%B0%D0%B1%D1%96%D0%BB%D1%96%D0%B7%D0%B0%D1%86%D1%96%D0%B9%D0%BD%D0%B8%D1%85/";
const SAVE_FILE = 'last_header.txt'; 

// Перевірка кожні 2 хвилини
const CHECK_INTERVAL = 120000; 
const WORK_DURATION = (4 * 60 * 60 * 1000) + (50 * 60 * 1000);

const bot = new TelegramBot(TOKEN, { polling: false });
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let lastKnownHeader = '';

async function startLoop() {
    console.log("🚀 ЗАПУСК: Режим «Стоп після 6.2»...");

    if (fs.existsSync(SAVE_FILE)) {
        lastKnownHeader = fs.readFileSync(SAVE_FILE, 'utf8').trim();
        console.log(`📂 В пам'яті: "${lastKnownHeader}"`);
    }

    const startTime = Date.now();

    while (true) {
        if (Date.now() - startTime > WORK_DURATION) {
            console.log("🛑 Зміна закінчена.");
            break; 
        }

        await checkSchedule();
        console.log(`⏳ Чекаю 2 хвилини...`);
        await wait(CHECK_INTERVAL);
    }
}

async function checkSchedule() {
    const timeLabel = new Date().toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kiev' });
    console.log(`[${timeLabel}] 🔄 Скачую...`);
    
    try {
        const response = await axios.get(ZOE_PAGE_URL + "?t=" + Date.now(), {
            timeout: 30000,
            httpsAgent: httpsAgent,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
        });

        if (response.status === 200) {
            const html = response.data;
            const plainText = convertHtmlToText(html);
            
            const result = findHeaderAndCleanBody(plainText);

            if (result) {
                const currentHeader = result.header;
                const cleanMessage = result.fullText;

                console.log(`🔍 Графік: "${currentHeader}"`);

                if (normalize(currentHeader) !== normalize(lastKnownHeader)) {
                    console.log(`🔥 ОНОВЛЕННЯ! Відправляю (без дублів)...`);
                    
                    await bot.sendMessage(CHAT_ID, cleanMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
                    
                    lastKnownHeader = currentHeader;
                    fs.writeFileSync(SAVE_FILE, currentHeader); 
                } else {
                    console.log("💤 Заголовок не змінився.");
                }
            } else {
                console.log("⚠️ Графік не знайдено.");
            }
        }
    } catch (e) {
        console.log(`❌ Помилка: ${e.message}`);
    }
}

// === ГОЛОВНА ЛОГІКА ФІЛЬТРАЦІЇ ===

function findHeaderAndCleanBody(text) {
    const lines = text.split('\n');
    
    // Заголовок (Дата + ГПВ)
    const headerRegex = /(\d{1,2})[\s\.]+(СІЧНЯ|ЛЮТОГО|БЕРЕЗНЯ|КВІТНЯ|ТРАВНЯ|ЧЕРВНЯ|ЛИПНЯ|СЕРПНЯ|ВЕРЕСНЯ|ЖОВТНЯ|ЛИСТОПАДА|ГРУДНЯ|\d{2}).*(ГПВ|ГРАФІК|ОНОВЛЕНО|ДІЯТИМУТЬ)/i;

    // Регулярка для черг (1.1 ...)
    const exactQueueRegex = /^\s*[1-6]\.[1-2]/;

    let headerIndex = -1;
    let foundHeader = "";

    // 1. Шукаємо заголовок
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (headerRegex.test(line)) {
            if (line.includes("Орієнтовна схема")) continue;
            headerIndex = i;
            foundHeader = line;
            break; 
        }
    }

    if (headerIndex === -1) return null;

    // 2. Збираємо черги, але слідкуємо, щоб не піти на друге коло
    let cleanLines = [];
    
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();

        // Умова 1: Якщо знову бачимо заголовок з датою - СТОП
        if (i > headerIndex + 2 && headerRegex.test(line)) {
            break; 
        }

        // Умова 2: Якщо рядок схожий на чергу
        if (exactQueueRegex.test(line)) {
            
            // === ГОЛОВНА ПРАВКА ===
            // Якщо ми зустріли "1.1", але у нас вже є записані рядки...
            // Це означає, що почався старий графік. ЗУПИНЯЄМОСЬ!
            if (line.startsWith("1.1") && cleanLines.length > 0) {
                break;
            }

            cleanLines.push(line);
        }
    }

    if (cleanLines.length === 0) return null;

    const fullText = `⚡️ <b>${foundHeader}</b>\n\n${cleanLines.join('\n')}`;

    return {
        header: foundHeader,
        fullText: fullText
    };
}

function normalize(text) {
    return text.replace(/[^a-zA-Zа-яА-Я0-9]/g, '').toLowerCase();
}

function convertHtmlToText(html) {
    let t = html;
    t = t.replace(/<style([\s\S]*?)<\/style>/gi, "").replace(/<script([\s\S]*?)<\/script>/gi, "");
    t = t.replace(/<\/(div|p|tr|li|h[1-6])>/gi, "\n");
    t = t.replace(/<br\s*\/?>/gi, "\n");
    t = t.replace(/<\/td>/gi, " "); 
    t = t.replace(/<[^>]+>/g, ""); 
    t = t.replace(/&nbsp;/g, " ")
         .replace(/&#8211;/g, "-")
         .replace(/&ndash;/g, "-")
         .replace(/&#8217;/g, "'")
         .replace(/&quot;/g, '"');
    return t.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
}

startLoop();
