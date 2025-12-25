const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const https = require('https');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ZOE_PAGE_URL = "https://www.zoe.com.ua/%D0%B3%D1%80%D0%B0%D1%84%D1%96%D0%BA%D0%B8-%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B8%D0%BD%D0%BD%D0%B8%D1%85-%D1%81%D1%82%D0%B0%D0%B1%D1%96%D0%BB%D1%96%D0%B7%D0%B0%D1%86%D1%96%D0%B9%D0%BD%D0%B8%D1%85/";
const STATE_FILE = 'zoe_state.json';

// Налаштування
const CHECK_INTERVAL = 120000; // 2 хвилини
const WORK_DURATION = (4 * 60 * 60 * 1000) + (50 * 60 * 1000);

const bot = new TelegramBot(TOKEN, { polling: false });
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Місяці для перевірки (щоб не плутати Листопад з Груднем)
const UA_MONTHS = ["СІЧНЯ", "ЛЮТОГО", "БЕРЕЗНЯ", "КВІТНЯ", "ТРАВНЯ", "ЧЕРВНЯ", "ЛИПНЯ", "СЕРПНЯ", "ВЕРЕСНЯ", "ЖОВТНЯ", "ЛИСТОПАДА", "ГРУДНЯ"];

let memory = { today: "", tomorrow: "" };

async function startLoop() {
    console.log("🚀 ЗАПУСК: Перевірка місяця та чистоти даних...");

    if (fs.existsSync(STATE_FILE)) {
        try {
            memory = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            console.log("📂 Пам'ять завантажено.");
        } catch (e) {
            console.log("⚠️ Помилка пам'яті.");
        }
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
    console.log(`[${timeLabel}] 🔄 Сканую...`);
    
    try {
        const response = await axios.get(ZOE_PAGE_URL + "?t=" + Date.now(), {
            timeout: 30000,
            httpsAgent: httpsAgent,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
        });

        if (response.status === 200) {
            const html = response.data;
            const plainText = convertHtmlToText(html);
            
            // Парсимо з урахуванням місяця
            const foundSchedules = parseSchedulesByDate(plainText);

            // 1. СЬОГОДНІ
            if (foundSchedules.today) {
                const currentHeader = foundSchedules.today.split('\n')[0];
                const savedHeader = memory.today ? memory.today.split('\n')[0] : "";

                // Порівнюємо без урахування регістру і пробілів
                if (normalize(currentHeader) !== normalize(savedHeader)) {
                    console.log(`🔥 ОНОВЛЕННЯ СЬОГОДНІ: ${currentHeader}`);
                    await bot.sendMessage(CHAT_ID, foundSchedules.today, { parse_mode: 'HTML', disable_web_page_preview: true });
                    memory.today = foundSchedules.today;
                    saveState();
                }
            }

            // 2. ЗАВТРА
            if (foundSchedules.tomorrow) {
                const currentHeader = foundSchedules.tomorrow.split('\n')[0];
                const savedHeader = memory.tomorrow ? memory.tomorrow.split('\n')[0] : "";

                if (normalize(currentHeader) !== normalize(savedHeader)) {
                    console.log(`🔥 ОНОВЛЕННЯ ЗАВТРА: ${currentHeader}`);
                    await bot.sendMessage(CHAT_ID, foundSchedules.tomorrow, { parse_mode: 'HTML', disable_web_page_preview: true });
                    memory.tomorrow = foundSchedules.tomorrow;
                    saveState();
                }
            }
            
            if (!foundSchedules.today && !foundSchedules.tomorrow) {
                console.log("💤 Не знайдено графіків за поточні дати.");
            }
        }
    } catch (e) {
        console.log(`❌ Помилка: ${e.message}`);
    }
}

function saveState() {
    fs.writeFileSync(STATE_FILE, JSON.stringify(memory, null, 2));
}

// === ГОЛОВНА ЛОГІКА ===
function parseSchedulesByDate(text) {
    const lines = text.split('\n');
    const result = { today: null, tomorrow: null };

    // Визначаємо поточні дати
    const uaDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
    
    const dayToday = uaDate.getDate(); 
    const monthNameToday = UA_MONTHS[uaDate.getMonth()]; // Наприклад "ГРУДНЯ"
    
    const uaTomorrow = new Date(uaDate);
    uaTomorrow.setDate(dayToday + 1);
    const dayTomorrow = uaTomorrow.getDate();
    const monthNameTomorrow = UA_MONTHS[uaTomorrow.getMonth()];

    // Регулярка: шукає Число + Місяць (словом)
    // (СІЧНЯ|...|ГРУДНЯ) - обов'язково
    const headerRegex = /(\d{1,2})[\s\.]+(СІЧНЯ|ЛЮТОГО|БЕРЕЗНЯ|КВІТНЯ|ТРАВНЯ|ЧЕРВНЯ|ЛИПНЯ|СЕРПНЯ|ВЕРЕСНЯ|ЖОВТНЯ|ЛИСТОПАДА|ГРУДНЯ)/i;
    
    // Регулярка для черг: суворо початок рядка "1.1", "2.1" тощо
    const exactQueueRegex = /^\s*[1-6]\.[1-2]/;

    let currentBlock = null; 
    let bufferHeader = "";
    let bufferLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // 1. Знайшли заголовок дати?
        const match = line.match(headerRegex);
        if (match && (line.includes("ГПВ") || line.toUpperCase().includes("ГРАФІК") || line.toUpperCase().includes("ОНОВЛЕНО"))) {
            
            // Якщо це "Орієнтовна схема" - ігноруємо
            if (line.includes("Орієнтовна схема")) continue;

            // Зберігаємо попередній блок, якщо він був
            if (currentBlock && bufferLines.length > 0) {
                result[currentBlock] = `⚡️ <b>${bufferHeader}</b>\n\n${bufferLines.join('\n')}`;
            }

            // --- ПЕРЕВІРКА ДАТИ ---
            const foundDay = parseInt(match[1]);
            const foundMonth = match[2].toUpperCase(); // Місяць з тексту

            // Скидаємо буфер
            bufferHeader = line;
            bufferLines = [];
            currentBlock = null;

            // Перевіряємо, чи збігається дата і МІСЯЦЬ
            if (foundDay === dayToday && foundMonth === monthNameToday) {
                currentBlock = 'today';
            } else if (foundDay === dayTomorrow && foundMonth === monthNameTomorrow) {
                currentBlock = 'tomorrow';
            }
            // Якщо місяць не збігається (наприклад "25 Листопада"), currentBlock залишиться null, і ми проігноруємо цей блок
            continue;
        }

        // 2. Збираємо рядки (ТІЛЬКИ ЯКЩО МИ В АКТУАЛЬНОМУ БЛОЦІ)
        if (currentBlock) {
            // Беремо рядок ТІЛЬКИ якщо він починається на цифри черги (1.1 ...)
            if (exactQueueRegex.test(line)) {
                
                // Стоп-кран: якщо знову 1.1 - це дубль, закриваємо блок
                if (line.startsWith("1.1") && bufferLines.length > 0) {
                     result[currentBlock] = `⚡️ <b>${bufferHeader}</b>\n\n${bufferLines.join('\n')}`;
                     currentBlock = null;
                     bufferLines = [];
                     continue;
                }
                bufferLines.push(line);
            }
        }
    }

    // Зберігаємо хвіст
    if (currentBlock && bufferLines.length > 0) {
        result[currentBlock] = `⚡️ <b>${bufferHeader}</b>\n\n${bufferLines.join('\n')}`;
    }

    return result;
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
    t = t.replace(/&nbsp;/g, " ").replace(/&#8211;/g, "-").replace(/&ndash;/g, "-").replace(/&#8217;/g, "'").replace(/&quot;/g, '"');
    return t.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
}

startLoop();
