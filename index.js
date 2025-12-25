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
const UA_MONTHS = ["СІЧНЯ", "ЛЮТОГО", "БЕРЕЗНЯ", "КВІТНЯ", "ТРАВНЯ", "ЧЕРВНЯ", "ЛИПНЯ", "СЕРПНЯ", "ВЕРЕСНЯ", "ЖОВТНЯ", "ЛИСТОПАДА", "ГРУДНЯ"];

const bot = new TelegramBot(TOKEN, { polling: false });
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let memory = { today: "", tomorrow: "" };

async function startLoop() {
    console.log("🚀 ЗАПУСК: Режим точної копії червоного заголовка...");

    if (fs.existsSync(STATE_FILE)) {
        try {
            memory = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            console.log("📂 Пам'ять завантажено.");
        } catch (e) {
            console.log("⚠️ Помилка читання пам'яті.");
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
            
            // 1. Витягуємо червоний заголовок ПОВНІСТЮ (разом з часом оновлення)
            const exactHeader = extractBigHeader(html);

            // 2. Отримуємо звичайний текст
            let plainText = convertHtmlToText(html);

            // 3. Якщо знайшли точний заголовок, приклеюємо його на початок
            if (exactHeader) {
                //console.log(`🎯 Знайдено точний заголовок: "${exactHeader}"`);
                plainText = exactHeader + "\n" + plainText;
            }

            const foundSchedules = parseSchedulesByDate(plainText);

            // 1. СЬОГОДНІ
            if (foundSchedules.today) {
                if (normalize(foundSchedules.today) !== normalize(memory.today)) {
                    console.log(`🔥 ОНОВЛЕННЯ СЬОГОДНІ!`);
                    await bot.sendMessage(CHAT_ID, foundSchedules.today, { parse_mode: 'HTML', disable_web_page_preview: true });
                    memory.today = foundSchedules.today;
                    saveState();
                }
            }

            // 2. ЗАВТРА
            if (foundSchedules.tomorrow) {
                if (normalize(foundSchedules.tomorrow) !== normalize(memory.tomorrow)) {
                    console.log(`🔥 ОНОВЛЕННЯ ЗАВТРА!`);
                    await bot.sendMessage(CHAT_ID, foundSchedules.tomorrow, { parse_mode: 'HTML', disable_web_page_preview: true });
                    memory.tomorrow = foundSchedules.tomorrow;
                    saveState();
                }
            }
        }
    } catch (e) {
        console.log(`❌ Помилка: ${e.message}`);
    }
}

function saveState() {
    fs.writeFileSync(STATE_FILE, JSON.stringify(memory, null, 2));
}

// === ГОЛОВНА ФУНКЦІЯ ДЛЯ ВИТЯГУВАННЯ ЗАГОЛОВКА ===
function extractBigHeader(html) {
    // 1. Шукаємо маркер розміру шрифту
    const marker = 'font-size: 24px';
    const startIdx = html.indexOf(marker);
    
    if (startIdx === -1) return null;

    // 2. Беремо шматок від маркера до найближчого <br> або </p>
    // Це гарантує, що ми захопимо І дату, І час оновлення (вони в одному параграфі)
    let chunk = html.substring(startIdx);
    
    // Шукаємо, де закінчується цей блок (перенос рядка або кінець параграфа)
    const endIdx = chunk.search(/<br|<\/p>/i);
    
    if (endIdx !== -1) {
        chunk = chunk.substring(0, endIdx);
    }

    // 3. Агресивна чистка
    // Замінюємо &nbsp; на пробіли
    chunk = chunk.replace(/&nbsp;/g, ' ');
    // Видаляємо ВСІ теги (<span>, <strong> і т.д.), замінюючи їх на пробіли, щоб слова не злиплися
    chunk = chunk.replace(/<[^>]+>/g, ' ');
    // Прибираємо лапки, якщо вони є (на скріншоті були зайві ")
    chunk = chunk.replace(/"/g, '');
    
    // Прибираємо зайві пробіли (подвійні, потрійні)
    let finalHeader = chunk.replace(/\s+/g, ' ').trim();

    // Перевірка: текст повинен містити "ОНОВЛЕНО" або "ГПВ"
    if (finalHeader.length > 5 && (finalHeader.includes("ОНОВЛЕНО") || finalHeader.includes("ГПВ"))) {
        return finalHeader;
    }

    return null;
}

// === ПАРСЕР РОЗКЛАДУ ===
function parseSchedulesByDate(text) {
    const lines = text.split('\n');
    const result = { today: null, tomorrow: null };

    const uaDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
    const dayToday = uaDate.getDate(); 
    const monthNameToday = UA_MONTHS[uaDate.getMonth()];
    
    const uaTomorrow = new Date(uaDate);
    uaTomorrow.setDate(dayToday + 1);
    const dayTomorrow = uaTomorrow.getDate();
    const monthNameTomorrow = UA_MONTHS[uaTomorrow.getMonth()];

    // Регулярка для дати
    const headerRegex = /(\d{1,2})[\s\.]+(СІЧНЯ|ЛЮТОГО|БЕРЕЗНЯ|КВІТНЯ|ТРАВНЯ|ЧЕРВНЯ|ЛИПНЯ|СЕРПНЯ|ВЕРЕСНЯ|ЖОВТНЯ|ЛИСТОПАДА|ГРУДНЯ)/i;
    // Регулярка для черг
    const exactQueueRegex = /^\s*[1-6]\.[1-2]/;

    let currentBlock = null; 
    let bufferHeader = "";
    let bufferLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // --- АНАЛІЗ ЗАГОЛОВКА ---
        const match = line.match(headerRegex);
        
        // Умова: це рядок з датою ТА (містить ключові слова АБО це наш витягнутий точний заголовок)
        if (match && (line.includes("ГПВ") || line.toUpperCase().includes("ГРАФІК") || line.toUpperCase().includes("ОНОВЛЕНО"))) {
            
            if (line.includes("Орієнтовна схема")) continue;

            // Зберігаємо попередній блок
            if (currentBlock && bufferLines.length > 0) {
                result[currentBlock] = `⚡️ <b>${bufferHeader}</b>\n\n${bufferLines.join('\n')}`;
            }

            const foundDay = parseInt(match[1]);
            const foundMonth = match[2].toUpperCase();

            // Скидаємо буфери
            bufferLines = [];
            currentBlock = null;

            // Визначаємо день
            if (foundDay === dayToday && foundMonth === monthNameToday) {
                currentBlock = 'today';
            } else if (foundDay === dayTomorrow && foundMonth === monthNameTomorrow) {
                currentBlock = 'tomorrow';
            }

            // === ВАЖЛИВО: ЗБЕРЕЖЕННЯ ТОЧНОГО ТЕКСТУ ===
            // Якщо рядок містить "ОНОВЛЕНО ГПВ" - це наш витягнутий заголовок.
            // Ми беремо його ЯК Є, не змінюючи.
            if (line.includes("ОНОВЛЕНО") && line.includes("ГПВ")) {
                bufferHeader = line; 
            } else {
                // Тільки якщо це НЕ червоний заголовок, тоді перевіряємо на "сміття"
                if (line.length > 100 || line.includes("Відповідно") || line.includes("Укренерго")) {
                    bufferHeader = `ГРАФІК ВІДКЛЮЧЕНЬ НА ${foundDay} ${foundMonth}`;
                } else {
                    bufferHeader = line;
                }
            }
            continue;
        }

        // --- ЗБІР ЧЕРГ ---
        if (currentBlock) {
            if (exactQueueRegex.test(line)) {
                // Видалення дублікатів (якщо сторінка глючить)
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

    if (currentBlock && bufferLines.length > 0) {
        result[currentBlock] = `⚡️ <b>${bufferHeader}</b>\n\n${bufferLines.join('\n')}`;
    }

    return result;
}

function normalize(text) {
    if (!text) return "";
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
