const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const https = require('https');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// === НОВА СТРАТЕГІЯ: ПАРСИНГ HTML СТОРІНКИ ===
// Ми йдемо прямо на сторінку графіків (посилання взято з вашого XML)
// Використовуємо encoded URL (кирилиця в URL)
const ZOE_PAGE_URL = "https://www.zoe.com.ua/%D0%B3%D1%80%D0%B0%D1%84%D1%96%D0%BA%D0%B8-%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B8%D0%BD%D0%BD%D0%B8%D1%85-%D1%81%D1%82%D0%B0%D0%B1%D1%96%D0%BB%D1%96%D0%B7%D0%B0%D1%86%D1%96%D0%B9%D0%BD%D0%B8%D1%85/";
const SAVE_FILE = 'last_header.txt'; 

// Перевірка кожні 3 хвилини
const CHECK_INTERVAL = 120000; 
// Час роботи зміни: 4 години 50 хвилин
const WORK_DURATION = (4 * 60 * 60 * 1000) + (50 * 60 * 1000);

const bot = new TelegramBot(TOKEN, { polling: false });
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let lastKnownHeader = '';

async function startLoop() {
    console.log("🚀 ЗАПУСК: HTML Парсинг сторінки графіків...");
    const startTime = Date.now();

    if (fs.existsSync(SAVE_FILE)) {
        lastKnownHeader = fs.readFileSync(SAVE_FILE, 'utf8').trim();
        console.log(`📂 Пам'ять: "${lastKnownHeader}"`);
    }

    while (true) {
        if (Date.now() - startTime > WORK_DURATION) {
            console.log("🛑 Зміна закінчена. Зберігаю дані.");
            break; 
        }

        await checkSchedule();
        console.log(`⏳ Чекаю 3 хвилини...`);
        await wait(CHECK_INTERVAL);
    }
}

async function checkSchedule() {
    const timeLabel = new Date().toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kiev' });
    console.log(`[${timeLabel}] 🔄 Скачую сторінку...`);
    
    try {
        // Скачуємо HTML сторінки як звичайний текст
        const response = await axios.get(ZOE_PAGE_URL + "?t=" + Date.now(), {
            timeout: 30000,
            httpsAgent: httpsAgent,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml'
            }
        });

        if (response.status === 200) {
            const html = response.data;
            
            // 1. Конвертуємо весь HTML у простий текст
            const plainText = convertHtmlToText(html);
            
            // 2. Шукаємо блок з графіком
            const cleanMessage = extractOneScheduleBlock(plainText);

            if (cleanMessage.length > 10) {
                const currentHeader = cleanMessage.split('\n')[0].trim();
                
                // Для налагодження (щоб ви бачили в логах, що він знайшов)
                console.log(`🔍 Знайшов заголовок: "${currentHeader}"`);

                if (normalize(currentHeader) !== normalize(lastKnownHeader)) {
                    console.log(`🔥 ОНОВЛЕННЯ! Відправляю...`);
                    
                    await bot.sendMessage(CHAT_ID, cleanMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
                    
                    lastKnownHeader = currentHeader;
                    fs.writeFileSync(SAVE_FILE, currentHeader); 
                } else {
                    console.log("💤 Графік не змінився.");
                }
            } else {
                console.log("⚠️ Графік не знайдено на сторінці (можливо змінився формат).");
                // Виведемо шматок тексту для перевірки
                // console.log(plainText.substring(0, 500)); 
            }
        }
    } catch (e) {
        console.log(`❌ Помилка завантаження: ${e.message}`);
    }
}

// === ФУНКЦІЇ ОБРОБКИ ===

function extractOneScheduleBlock(text) {
    const lines = text.split('\n');
    let bestHeader = ""; 
    let queueLines = [];
    let queuesFound = false; 
    
    // Регулярка для дати (включаючи точки, наприклад 26.12)
    const dateRegex = /(\d{1,2})[\s\.]+(СІЧНЯ|ЛЮТОГО|БЕРЕЗНЯ|КВІТНЯ|ТРАВНЯ|ЧЕРВНЯ|ЛИПНЯ|СЕРПНЯ|ВЕРЕСНЯ|ЖОВТНЯ|ЛИСТОПАДА|ГРУДНЯ|\d{2})/i;
    const queueRegex = /^\s*\d\.\d\s*[:\.]/; 

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length < 3) continue;
        
        if (dateRegex.test(line) && (
            line.includes("ГПВ") || 
            line.toUpperCase().includes("ОНОВЛЕНО") || 
            line.toUpperCase().includes("ГРАФІК") ||
            line.toUpperCase().includes("ДІЯТИМУТЬ")
        )) {
             if (line.includes("Орієнтовна схема")) continue;
             if (queuesFound) break; 
             
             if (line.toUpperCase().includes("ДІЯТИМУТЬ")) {
                 bestHeader = line;
             } 
             else if (bestHeader === "" || (isUpperCase(line) && !isUpperCase(bestHeader))) {
                 bestHeader = line;
             }
        }
        
        if (queueRegex.test(line)) { queueLines.push(line); queuesFound = true; }
    }
    
    if (!bestHeader && queueLines.length > 0) bestHeader = "⚡️ <b>Графік відключень:</b>";
    else if (bestHeader) bestHeader = "⚡️ <b>" + bestHeader + "</b>";
    
    if (queueLines.length === 0) return "";
    return bestHeader + "\n\n" + queueLines.join('\n');
}

function normalize(text) {
    return text.replace(/[^a-zA-Zа-яА-Я0-9]/g, '').toLowerCase();
}

function isUpperCase(str) {
    const l = str.replace(/[^а-яА-Яa-zA-Z]/g, ""); 
    return l.length > 0 && (l.split('').filter(c => c === c.toUpperCase()).length / l.length) > 0.7;
}

function convertHtmlToText(html) {
    let t = html;
    // Видаляємо скрипти та стилі
    t = t.replace(/<style([\s\S]*?)<\/style>/gi, "").replace(/<script([\s\S]*?)<\/script>/gi, "");
    // Замінюємо BR та P на переноси рядків
    t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n").replace(/<\/li>/gi, "\n");
    // Чистимо теги
    t = t.replace(/<[^>]+>/g, " "); 
    
    // Чистимо спецсимволи HTML
    t = t.replace(/&nbsp;/g, " ")
         .replace(/&#8211;/g, "-")
         .replace(/&#8217;/g, "'")
         .replace(/&quot;/g, '"')
         .replace(/&amp;/g, '&')
         .replace(/&lt;/g, '<')
         .replace(/&gt;/g, '>');
         
    // Прибираємо зайві пробіли та пусті рядки
    return t.replace(/\s+/g, ' ').replace(/ \n/g, '\n').replace(/\n\s+/g, '\n').trim();
}

startLoop();
