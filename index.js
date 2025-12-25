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
    console.log("🚀 ЗАПУСК: Парсер (Точна копія шапки 24px)...");

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
            
            // 1. Екстракція ТОЧНОГО тексту червоного заголовка
            const exactHeader = extractBigHeader(html);
            
            // 2. Отримання звичайного тексту
            let plainText = convertHtmlToText(html);

            // 3. Ін'єкція заголовка
            // Ми додаємо його на самий початок, щоб парсер зчитав дату саме з нього
            if (exactHeader) {
                // console.log(`🎯 Заголовок для публікації: "${exactHeader}"`);
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

// === ОНОВЛЕНА ФУНКЦІЯ ДЛЯ ВАШОГО HTML ===
function extractBigHeader(html) {
    // 1. Шукаємо початок блоку з шрифтом 24px
    const marker = 'font-size: 24px';
    const startIdx = html.indexOf(marker);
    
    if (startIdx === -1) return null;

    // 2. Відрізаємо все що ДО
    let workingPart = html.substring(startIdx);

    // 3. Шукаємо кінець цього рядка. У вашому HTML після заголовка йде <br />.
    // Це найважливіший момент: ми беремо все до <br /> або до </p>
    let endIdx = workingPart.search(/<br\s*\/?>|<\/p>/i);
    
    if (endIdx === -1) {
        // Якщо раптом <br> немає, беремо перші 300 символів (страховка)
        endIdx = 300;
    }

    let rawFragment = workingPart.substring(0, endIdx);

    // 4. Очищення від сміття
    // Спочатку перетворюємо HTML спецсимволи &nbsp; на пробіли
    let cleanText = rawFragment.replace(/&nbsp;/g, ' ');
    
    // Видаляємо ВСІ теги (<span...>, <strong>, </span> і т.д.)
    cleanText = cleanText.replace(/<[^>]+>/g, ' ');

    // Прибираємо зайві пробіли (подвійні, табуляції) і обрізаємо краї
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    // 5. Перевірка: текст повинен містити "ГПВ" або "ОНОВЛЕНО" або "ГРАФІК"
    if (cleanText.length > 5 && (cleanText.includes("ОНОВЛЕНО") || cleanText.includes("ГПВ") || cleanText.includes("ГРАФІК"))) {
        return cleanText;
    }

    return null;
}

// === ПАРСЕР ===
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

    // Регулярка, яка шукає дату (наприклад 26 ГРУДНЯ) будь-де в рядку
    const dateRegex = /(\d{1,2})[\s\.]+(СІЧНЯ|ЛЮТОГО|БЕРЕЗНЯ|КВІТНЯ|ТРАВНЯ|ЧЕРВНЯ|ЛИПНЯ|СЕРПНЯ|ВЕРЕСНЯ|ЖОВТНЯ|ЛИСТОПАДА|ГРУДНЯ)/i;
    // Регулярка черг
    const exactQueueRegex = /^\s*[1-6]\.[1-2]/;

    let currentBlock = null; 
    let bufferHeader = "";
    let bufferLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0) continue;
        
        // Перевіряємо, чи є дата в цьому рядку
        const match = line.match(dateRegex);
        
        // Це рядок заголовка, якщо в ньому є дата І (ключові слова АБО це наш витягнутий заголовок)
        if (match && (line.includes("ГПВ") || line.includes("ГРАФІК") || line.includes("ОНОВЛЕНО") || line.includes("ВІДКЛЮЧЕН"))) {
            
            if (line.includes("Орієнтовна схема")) continue;

            // Зберігаємо старий блок
            if (currentBlock && bufferLines.length > 0) {
                result[currentBlock] = `⚡️ <b>${bufferHeader}</b>\n\n${bufferLines.join('\n')}`;
            }

            const foundDay = parseInt(match[1]);
            const foundMonth = match[2].toUpperCase();

            // Скидання
            bufferLines = [];
            currentBlock = null;

            // Визначення дати
            if (foundDay === dayToday && foundMonth === monthNameToday) {
                currentBlock = 'today';
            } else if (foundDay === dayTomorrow && foundMonth === monthNameTomorrow) {
                currentBlock = 'tomorrow';
            }

            // === ЛОГІКА ЗАГОЛОВКА ===
            // Якщо рядок містить "ОНОВЛЕНО" або "24px" контент - беремо його як є
            // Якщо рядок занадто довгий і "офіційний" - замінюємо на короткий
            if (line.includes("ОНОВЛЕНО") || line.includes("(оновлено")) {
                bufferHeader = line; // Зберігаємо точний текст з сайту!
            } else if (line.length > 100 || line.includes("Відповідно") || line.includes("Укренерго")) {
                bufferHeader = `ГРАФІК ВІДКЛЮЧЕНЬ НА ${foundDay} ${foundMonth}`;
            } else {
                bufferHeader = line;
            }
            continue;
        }

        // --- ЗБІР ЧЕРГ ---
        if (currentBlock) {
            if (exactQueueRegex.test(line)) {
                // Захист від дублікатів
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
