const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const jsdom = require("jsdom"); // НАМ ПОТРІБНА JSDOM АБО МИ ЗРОБИМО ЦЕ РЕГУЛЯРКАМИ (Нижче варіант без JSDOM, чистий JS)

const TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ZOE_PAGE_URL = "https://www.zoe.com.ua/%D0%B3%D1%80%D0%B0%D1%84%D1%96%D0%BA%D0%B8-%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B8%D0%BD%D0%BD%D0%B8%D1%85-%D1%81%D1%82%D0%B0%D0%B1%D1%96%D0%BB%D1%96%D0%B7%D0%B0%D1%86%D1%96%D0%B9%D0%BD%D0%B8%D1%85/";
const STATE_FILE = 'zoe_state.json';

// Налаштування
const CHECK_INTERVAL = 120000; // 2 хвилини
const WORK_DURATION = (4 * 60 * 60 * 1000) + (50 * 60 * 1000); // Час роботи бота
const UA_MONTHS = ["СІЧНЯ", "ЛЮТОГО", "БЕРЕЗНЯ", "КВІТНЯ", "ТРАВНЯ", "ЧЕРВНЯ", "ЛИПНЯ", "СЕРПНЯ", "ВЕРЕСНЯ", "ЖОВТНЯ", "ЛИСТОПАДА", "ГРУДНЯ"];

const bot = new TelegramBot(TOKEN, { polling: false });
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let memory = { today: "", tomorrow: "" };

async function startLoop() {
    console.log("🚀 ЗАПУСК: Розумний блочний парсер (з файлу 123.txt)...");

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
            const foundSchedules = parseHtmlSmart(html);

            // 1. СЬОГОДНІ
            if (foundSchedules.today) {
                // Порівнюємо видаливши зайві пробіли, щоб уникнути помилкових спрацювань
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

// === ГОЛОВНА ЛОГІКА ПАРСИНГУ ===
function parseHtmlSmart(html) {
    const result = { today: null, tomorrow: null };

    // Дати для порівняння
    const uaDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Europe/Kiev"}));
    const dayToday = uaDate.getDate(); 
    const monthNameToday = UA_MONTHS[uaDate.getMonth()];
    
    const uaTomorrow = new Date(uaDate);
    uaTomorrow.setDate(dayToday + 1);
    const dayTomorrow = uaTomorrow.getDate();
    const monthNameTomorrow = UA_MONTHS[uaTomorrow.getMonth()];

    // 1. Розбиваємо HTML на "розумні рядки". 
    // Це масив об'єктів: { text: "string", isRed: boolean }
    const linesObj = splitHtmlToLinesWithStyle(html);

    let activeHeader = null; // Поточний найкращий заголовок
    let activeHeaderIsRed = false; // Чи є поточний заголовок "червоним" (VIP)
    
    let currentQueues = []; // Накопичувач черг
    let headerDateInfo = null; // { day: 25, month: "ГРУДНЯ" } для поточного заголовка

    // Регулярки
    const dateRegex = /(\d{1,2})[\s\.]+(СІЧНЯ|ЛЮТОГО|БЕРЕЗНЯ|КВІТНЯ|ТРАВНЯ|ЧЕРВНЯ|ЛИПНЯ|СЕРПНЯ|ВЕРЕСНЯ|ЖОВТНЯ|ЛИСТОПАДА|ГРУДНЯ)/i;
    const queueRegex = /^\s*[1-6]\.[1-2]/;

    for (let i = 0; i < linesObj.length; i++) {
        const lineData = linesObj[i];
        const text = lineData.text;
        const isRed = lineData.isRed; // true, якщо це font-size: 24px

        // А. Перевіряємо, чи це ЗАГОЛОВОК (містить дату і ключові слова)
        const dateMatch = text.match(dateRegex);
        const upperText = text.toUpperCase();
        
        const isHeaderKeywords = upperText.includes("ГПВ") || upperText.includes("ГРАФІК") || upperText.includes("ОНОВЛЕН") || upperText.includes("ВІДКЛЮЧЕН") || upperText.includes("ДІЯТИМУТЬ");

        if (dateMatch && isHeaderKeywords) {
            // Якщо ми зустріли новий потенційний заголовок, а старий вже мав черги -> треба зберегти попередній
            if (currentQueues.length > 0 && activeHeader) {
                saveBlock(result, activeHeader, currentQueues, headerDateInfo, dayToday, monthNameToday, dayTomorrow, monthNameTomorrow);
                currentQueues = [];
                activeHeader = null;
                activeHeaderIsRed = false;
            }

            // Логіка вибору заголовка:
            // 1. Якщо це "Червоний" (24px) - беремо без питань.
            // 2. Якщо це звичайний текст, беремо тільки якщо у нас ще немає активного заголовка АБО попередній не був червоним.
            // (Тобто червоний заголовок не можна перебити звичайним текстом "За вказівкою...")
            
            if (isRed) {
                activeHeader = text;
                activeHeaderIsRed = true;
                headerDateInfo = { day: parseInt(dateMatch[1]), month: dateMatch[2].toUpperCase() };
            } else {
                if (!activeHeaderIsRed) {
                    activeHeader = text;
                    headerDateInfo = { day: parseInt(dateMatch[1]), month: dateMatch[2].toUpperCase() };
                }
            }
            continue; // Йдемо далі, шукати черги
        }

        // Б. Перевіряємо, чи це ЧЕРГА (1.1: ...)
        if (queueRegex.test(text)) {
            // Фільтруємо дублікати (іноді 1.1 зустрічається двічі)
            if (text.startsWith("1.1:") && currentQueues.length > 0) {
                // Це початок нового блоку черг. Зберігаємо старий.
                if (activeHeader) {
                    saveBlock(result, activeHeader, currentQueues, headerDateInfo, dayToday, monthNameToday, dayTomorrow, monthNameTomorrow);
                }
                currentQueues = [];
                // Заголовок залишаємо той самий (він діє на обидва блоки, якщо вони розбиті)
            }
            currentQueues.push(text);
        }
    }

    // Зберігаємо останній блок після циклу
    if (currentQueues.length > 0 && activeHeader) {
        saveBlock(result, activeHeader, currentQueues, headerDateInfo, dayToday, monthNameToday, dayTomorrow, monthNameTomorrow);
    }

    return result;
}

// Функція збереження результату в today/tomorrow
function saveBlock(result, header, queues, dateInfo, todayD, todayM, tomD, tomM) {
    if (!dateInfo) return;

    let targetKey = null;
    if (dateInfo.day === todayD && dateInfo.month === todayM) targetKey = 'today';
    else if (dateInfo.day === tomD && dateInfo.month === tomM) targetKey = 'tomorrow';

    if (targetKey) {
        // Ми завжди перезаписуємо, бо йдемо зверху вниз. 
        // Останній знайдений графік на сторінці для конкретної дати зазвичай найактуальніший,
        // АЛЕ на сайті ZOE нові новини зверху. Тому ми перевіряємо:
        // Якщо ми вже щось записали в 'today', чи варто це міняти? 
        // У нашому циклі ми йдемо зверху вниз. Отже, ПЕРШИЙ знайдений блок для "сьогодні" - найсвіжіший.
        // Тому записуємо тільки якщо slot порожній.
        
        if (result[targetKey] === null) {
             result[targetKey] = `⚡️ <b>${header}</b>\n\n${queues.join('\n')}`;
        }
    }
}

// === СКЛАДНА ФУНКЦІЯ: Перетворює HTML в масив рядків, зберігаючи позначку "Це був 24px" ===
function splitHtmlToLinesWithStyle(html) {
    // 1. Замінюємо <br> і </p> на унікальний маркер розриву, щоб потім сплітнути
    let processed = html.replace(/<br\s*\/?>/gi, "||BR||").replace(/<\/p>/gi, "||BR||");

    // 2. Тепер найцікавіше. Нам треба знайти шматки, які всередині <span style="...font-size: 24px...">
    // Ми зробимо це тимчасовою заміною.
    
    // Шукаємо всі входження 24px
    const styleMarker = "font-size: 24px";
    let outputLines = [];
    
    // Грубий спліт по нашому маркеру
    let rawLines = processed.split("||BR||");

    for (let raw of rawLines) {
        // Чистимо від зайвих тегів, щоб отримати текст
        // Але перед цим перевіряємо, чи є тут наш VIP стиль
        let isRed = raw.includes(styleMarker);

        // Очищаємо текст
        let cleanText = raw
            .replace(/&nbsp;/g, " ")
            .replace(/<[^>]+>/g, "") // видаляємо всі теги
            .replace(/\s+/g, " ")    // схлопуємо пробіли
            .trim();

        if (cleanText.length > 0) {
            outputLines.push({
                text: cleanText,
                isRed: isRed
            });
        }
    }
    
    return outputLines;
}

function normalize(text) {
    if (!text) return "";
    return text.replace(/[^a-zA-Zа-яА-Я0-9]/g, '').toLowerCase();
}

startLoop();
