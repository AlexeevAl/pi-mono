const stages = ["money", "before", "campaign", "patient", "plan", "doctor", "followup", "owner", "pilot"];

let chatSteps = [
	{
		role: "patient",
		text: "Я боюсь, что будет неестественно. Не хочу, чтобы все заметили.",
		replies: ["Снять главный страх"],
	},
	{
		role: "linda",
		text: "Понимаю. Поэтому мы предлагаем мягкую коррекцию без перегруза. Врач сначала проверит, что подойдет именно вам.",
		replies: ["Уточнить цель"],
	},
	{
		role: "patient",
		text: "Хочу выглядеть свежее, но без резких изменений. И немного переживаю из-за боли.",
		replies: ["Зафиксировать страхи"],
	},
	{
		role: "linda",
		text: "Зафиксировала: натуральный эффект, контроль боли, без заметной искусственности. Какой бюджет комфортен?",
		replies: ["Средний+", "Премиум", "Пока не знаю"],
	},
	{
		role: "patient",
		text: "Средний+. Если план понятный, готова идти курсом.",
		replies: ["Показать рекомендацию"],
	},
	{
		role: "linda",
		text: "Рекомендую начать с консультации и мягкой коррекции. Есть окно в пятницу в 12:30. Забронировать?",
		replies: ["Да, записать"],
	},
	{
		role: "patient",
		text: "Да, пятница подходит.",
		replies: ["Открыть экран врача"],
	},
	{
		role: "linda",
		text: "Готово. Врач уже видит вашу цель, страх боли, бюджет и готовность к годовому плану.",
		replies: ["Показать возврат после визита"],
	},
];

let presentationSteps = [
	{
		stage: "money",
		chatStep: 0,
		title: "1. В базе уже есть невыбранная выручка",
		what: "Часть пациентов клиники давно не возвращалась, но уже знает клинику и доверяет ей больше, чем холодный лид из рекламы.",
		benefit: "Даже небольшой процент возврата дает заметную выручку без роста рекламного бюджета.",
		why: "На этом экране видно, сколько денег можно вернуть из текущей базы при вашем среднем чеке.",
		metrics: { reactivated: 0, revenue: 0, chairs: 0 },
	},
	{
		stage: "before",
		chatStep: 0,
		title: "2. Где клиника теряет пациентов и деньги",
		what: "Потери происходят между первым сообщением, консультацией и повторным визитом.",
		benefit: "LINDA закрывает разрывы: персональный ответ, понятный следующий шаг, контекст для врача и возврат после визита.",
		why: "Скрытая потеря выручки появляется не из-за одного слабого места, а из-за пауз между касаниями.",
		metrics: { reactivated: 8, revenue: 28000, chairs: 24 },
	},
	{
		stage: "campaign",
		chatStep: 0,
		title: "3. Пилот можно начать с 50 пациентов",
		what: "Запуск начинается с небольшого сегмента неактивной базы, а не со всей клиники сразу.",
		benefit: "Клиника быстро видит ответы, записи и спорные случаи без долгого внедрения.",
		why: "Так снижается риск: сначала проверяем экономику на малом сегменте, потом масштабируем.",
		metrics: { reactivated: 17, revenue: 61000, chairs: 39 },
	},
	{
		stage: "patient",
		chatStep: 3,
		title: "4. Пациент перестает быть “холодным лидом”",
		what: "Система заранее уточняет цель пациента, страхи, ожидания и бюджет.",
		benefit: "Администратор и врач получают подготовленного пациента, а не просто входящее сообщение.",
		why: "Чем точнее ответ на страх пациента, тем меньше потерь между интересом и записью.",
		metrics: { reactivated: 26, revenue: 94000, chairs: 52 },
	},
	{
		stage: "plan",
		chatStep: 6,
		title: "5. Пациент получает понятный следующий шаг",
		what: "Вместо общего прайса пациент получает персональную рекомендацию и доступные окна.",
		benefit: "Клиника переводит интерес в запись быстрее, без длинной паузы и лишней переписки.",
		why: "Общий прайс часто убивает продажу, а конкретный следующий шаг помогает принять решение.",
		metrics: { reactivated: 34, revenue: 128000, chairs: 64 },
	},
	{
		stage: "doctor",
		chatStep: 7,
		title: "6. Врач приходит на консультацию с контекстом",
		what: "Перед визитом врач видит краткое досье: цель, страх, бюджет и готовность к плану.",
		benefit: "Консультация становится точнее, а врач меньше продает “с нуля”.",
		why: "Контекст помогает закрывать на план лечения, а не на случайную разовую процедуру.",
		metrics: { reactivated: 43, revenue: 162000, chairs: 76 },
	},
	{
		stage: "followup",
		chatStep: 7,
		title: "7. Повторная выручка не теряется после визита",
		what: "После процедуры система возвращает пациента на контроль, уход и повторную запись.",
		benefit: "Клиника растит повторные визиты и LTV без постоянного давления на рекламу.",
		why: "Без системного возврата пациент может уйти к конкуренту, даже если первый визит прошел хорошо.",
		metrics: { reactivated: 47, revenue: 174000, chairs: 79 },
	},
	{
		stage: "owner",
		chatStep: 7,
		title: "8. Владельцу виден результат по всей воронке",
		what: "Владелец видит, сколько пациентов в работе, сколько ответили, сколько записались и где нужен человек.",
		benefit: "Решение о масштабировании принимается по цифрам, а не по ощущениям команды.",
		why: "Если первый сегмент дает записи, запуск можно расширять поэтапно и без риска для всей базы.",
		metrics: { reactivated: 50, revenue: 186000, chairs: 82 },
	},
	{
		stage: "pilot",
		chatStep: 7,
		title: "9. Следующий шаг для вашей клиники",
		what: "Запуск можно начать с 50 пациентов и первых свободных окон.",
		benefit: "Клиника видит ответы, записи и экономику до масштабирования на всю базу.",
		why: "Пилот на 7 дней снижает риск и быстро показывает, стоит ли расширять запуск.",
		metrics: { reactivated: 50, revenue: 186000, chairs: 82 },
	},
];

const marketPresets = {
	il: { label: "Израиль", currency: "₪", averageCheck: 1800, suffix: true },
	us: { label: "США", currency: "$", averageCheck: 450, suffix: false },
	eu: { label: "Европа", currency: "€", averageCheck: 400, suffix: false },
	ru: { label: "Россия", currency: "₽", averageCheck: 35000, suffix: true },
};

const localizedChatSteps = {
	ru: chatSteps,
	en: [
		{
			role: "patient",
			text: "I am afraid it will look unnatural. I do not want everyone to notice.",
			replies: ["Handle main fear"],
		},
		{
			role: "linda",
			text: "I understand. That is why we suggest gentle correction without overload. The doctor first checks what fits you specifically.",
			replies: ["Clarify goal"],
		},
		{
			role: "patient",
			text: "I want to look fresher, but without sharp changes. I am also a bit worried about pain.",
			replies: ["Capture concerns"],
		},
		{
			role: "linda",
			text: "Captured: natural result, pain control, no obvious artificiality. What budget is comfortable?",
			replies: ["Mid+", "Premium", "Not sure yet"],
		},
		{
			role: "patient",
			text: "Mid+. If the plan is clear, I am ready for a course.",
			replies: ["Show recommendation"],
		},
		{
			role: "linda",
			text: "I recommend starting with a consultation and gentle correction. Friday at 12:30 is available. Book it?",
			replies: ["Yes, book"],
		},
		{ role: "patient", text: "Yes, Friday works.", replies: ["Open doctor screen"] },
		{
			role: "linda",
			text: "Done. The doctor already sees your goal, pain concern, budget, and readiness for a yearly plan.",
			replies: ["Show post-visit return"],
		},
	],
	he: [
		{
			role: "patient",
			text: "אני מפחדת שזה ייראה לא טבעי. אני לא רוצה שכולם ישימו לב.",
			replies: ["להוריד את החשש המרכזי"],
		},
		{
			role: "linda",
			text: "אני מבינה. לכן אנחנו מציעים תיקון עדין בלי עומס. הרופא קודם בודק מה מתאים בדיוק לך.",
			replies: ["לחדד מטרה"],
		},
		{
			role: "patient",
			text: "אני רוצה להיראות רעננה יותר, אבל בלי שינוי חד. ואני קצת חוששת מכאב.",
			replies: ["לתעד חששות"],
		},
		{
			role: "linda",
			text: "תיעדתי: תוצאה טבעית, שליטה בכאב, בלי מראה מלאכותי ברור. איזה תקציב נוח לך?",
			replies: ["בינוני+", "פרימיום", "עדיין לא יודעת"],
		},
		{
			role: "patient",
			text: "בינוני+. אם התוכנית ברורה, אני מוכנה לסדרה.",
			replies: ["להציג המלצה"],
		},
		{
			role: "linda",
			text: "אני ממליצה להתחיל בייעוץ ותיקון עדין. יש תור פנוי ביום שישי ב-12:30. לקבוע?",
			replies: ["כן, לקבוע"],
		},
		{ role: "patient", text: "כן, יום שישי מתאים.", replies: ["לפתוח מסך רופא"] },
		{
			role: "linda",
			text: "נקבע. הרופא כבר רואה את המטרה שלך, החשש מכאב, התקציב והמוכנות לתוכנית שנתית.",
			replies: ["להציג חזרה אחרי ביקור"],
		},
	],
};

const localizedPresentationSteps = {
	ru: presentationSteps,
	en: [
		{
			stage: "money",
			chatStep: 0,
			title: "1. There is unclaimed revenue in the database",
			what: "Some patients have not returned for a long time, but they already know the clinic and trust it more than a cold ad lead.",
			benefit: "Even a small return rate creates meaningful revenue without increasing the ad budget.",
			why: "This screen shows how much money can be recovered from the current database at your average ticket.",
			metrics: { reactivated: 0, revenue: 0, chairs: 0 },
		},
		{
			stage: "before",
			chatStep: 0,
			title: "2. Where the clinic loses patients and money",
			what: "Losses happen between the first message, the consultation, and the repeat visit.",
			benefit: "LINDA closes the gaps: personal reply, clear next step, doctor context, and post-visit return.",
			why: "Hidden revenue loss comes from pauses between touchpoints, not from one isolated weak spot.",
			metrics: { reactivated: 8, revenue: 28000, chairs: 24 },
		},
		{
			stage: "campaign",
			chatStep: 0,
			title: "3. The pilot can start with 50 patients",
			what: "The launch starts with a small inactive segment, not the entire clinic at once.",
			benefit: "The clinic quickly sees replies, bookings, and sensitive cases without a long implementation.",
			why: "This reduces risk: first test the economics on a small segment, then scale.",
			metrics: { reactivated: 17, revenue: 61000, chairs: 39 },
		},
		{
			stage: "patient",
			chatStep: 3,
			title: "4. The patient stops being a cold lead",
			what: "The system clarifies the patient's goal, fears, expectations, and budget in advance.",
			benefit: "The admin and doctor receive a prepared patient, not just an incoming message.",
			why: "The more directly the fear is handled, the fewer losses between interest and booking.",
			metrics: { reactivated: 26, revenue: 94000, chairs: 52 },
		},
		{
			stage: "plan",
			chatStep: 6,
			title: "5. The patient gets a clear next step",
			what: "Instead of a generic price list, the patient receives a personal recommendation and available slots.",
			benefit: "The clinic turns interest into a booking faster, with less waiting and less back-and-forth.",
			why: "A generic price list often kills the sale; a concrete next step helps the patient decide.",
			metrics: { reactivated: 34, revenue: 128000, chairs: 64 },
		},
		{
			stage: "doctor",
			chatStep: 7,
			title: "6. The doctor comes prepared",
			what: "Before the visit, the doctor sees a short profile: goal, fear, budget, and readiness for a plan.",
			benefit: "The consultation becomes sharper, and the doctor sells less from zero.",
			why: "Context helps close a treatment plan instead of a random one-time procedure.",
			metrics: { reactivated: 43, revenue: 162000, chairs: 76 },
		},
		{
			stage: "followup",
			chatStep: 7,
			title: "7. Repeat revenue is not lost after the visit",
			what: "After the procedure, the system brings the patient back for a check, care, and repeat booking.",
			benefit: "The clinic grows repeat visits and patient LTV without constant pressure on ads.",
			why: "Without systematic return, a patient can go to a competitor even after a good first visit.",
			metrics: { reactivated: 47, revenue: 174000, chairs: 79 },
		},
		{
			stage: "owner",
			chatStep: 7,
			title: "8. The owner sees the full funnel result",
			what: "The owner sees how many patients are in work, how many replied, how many booked, and where a human is needed.",
			benefit: "Scaling decisions are made from numbers, not team impressions.",
			why: "If the first segment produces bookings, the launch can expand step by step without risking the whole base.",
			metrics: { reactivated: 50, revenue: 186000, chairs: 82 },
		},
		{
			stage: "pilot",
			chatStep: 7,
			title: "9. The next step for your clinic",
			what: "The launch can start with 50 patients and the first available slots.",
			benefit: "The clinic sees replies, bookings, and economics before scaling to the full database.",
			why: "A 7-day pilot lowers risk and quickly shows whether it is worth expanding.",
			metrics: { reactivated: 50, revenue: 186000, chairs: 82 },
		},
	],
	he: [
		{
			stage: "money",
			chatStep: 0,
			title: "1. יש במאגר הכנסה שעדיין לא נוצלה",
			what: "חלק מהמטופלים לא חזרו זמן רב, אבל הם כבר מכירים את הקליניקה וסומכים עליה יותר מליד קר מפרסום.",
			benefit: "גם אחוז חזרה קטן מייצר הכנסה משמעותית בלי להגדיל תקציב פרסום.",
			why: "המסך הזה מראה כמה כסף אפשר להחזיר מהמאגר הקיים לפי הצ'ק הממוצע שלכם.",
			metrics: { reactivated: 0, revenue: 0, chairs: 0 },
		},
		{
			stage: "before",
			chatStep: 0,
			title: "2. איפה הקליניקה מאבדת מטופלים וכסף",
			what: "ההפסדים קורים בין ההודעה הראשונה, הייעוץ והביקור החוזר.",
			benefit: "LINDA סוגרת את הפערים: תשובה אישית, צעד הבא ברור, הקשר לרופא וחזרה אחרי ביקור.",
			why: "אובדן הכנסה נסתר נוצר מהפסקות בין נקודות מגע, לא רק מחולשה אחת.",
			metrics: { reactivated: 8, revenue: 28000, chairs: 24 },
		},
		{
			stage: "campaign",
			chatStep: 0,
			title: "3. אפשר להתחיל פיילוט עם 50 מטופלים",
			what: "ההפעלה מתחילה ממקטע קטן של מטופלים לא פעילים, לא מכל הקליניקה בבת אחת.",
			benefit: "הקליניקה רואה מהר תגובות, תורים ומקרים רגישים בלי הטמעה ארוכה.",
			why: "כך מורידים סיכון: קודם בודקים כלכלה במקטע קטן, אחר כך מרחיבים.",
			metrics: { reactivated: 17, revenue: 61000, chairs: 39 },
		},
		{
			stage: "patient",
			chatStep: 3,
			title: "4. המטופל מפסיק להיות ליד קר",
			what: "המערכת מבררת מראש את מטרת המטופל, החששות, הציפיות והתקציב.",
			benefit: "מנהל הקבלה והרופא מקבלים מטופל מוכן יותר, לא רק הודעה נכנסת.",
			why: "ככל שעונים טוב יותר על החשש, יש פחות נפילות בין עניין לקביעת תור.",
			metrics: { reactivated: 26, revenue: 94000, chairs: 52 },
		},
		{
			stage: "plan",
			chatStep: 6,
			title: "5. המטופל מקבל צעד הבא ברור",
			what: "במקום מחירון כללי, המטופל מקבל המלצה אישית וחלונות זמן פנויים.",
			benefit: "הקליניקה הופכת עניין לתור מהר יותר, עם פחות המתנה ופחות התכתבויות.",
			why: "מחירון כללי הרבה פעמים הורג מכירה; צעד הבא ברור עוזר לקבל החלטה.",
			metrics: { reactivated: 34, revenue: 128000, chairs: 64 },
		},
		{
			stage: "doctor",
			chatStep: 7,
			title: "6. הרופא מגיע לייעוץ עם הקשר",
			what: "לפני הביקור הרופא רואה פרופיל קצר: מטרה, חשש, תקציב ומוכנות לתוכנית.",
			benefit: "הייעוץ מדויק יותר והרופא מוכר פחות מאפס.",
			why: "הקשר עוזר לסגור תוכנית טיפול, לא פעולה חד-פעמית אקראית.",
			metrics: { reactivated: 43, revenue: 162000, chairs: 76 },
		},
		{
			stage: "followup",
			chatStep: 7,
			title: "7. הכנסה חוזרת לא נעלמת אחרי הביקור",
			what: "אחרי הטיפול המערכת מחזירה את המטופל לביקורת, טיפול ביתי ותור חוזר.",
			benefit: "הקליניקה מגדילה ביקורים חוזרים ו-LTV בלי לחץ קבוע על פרסום.",
			why: "בלי חזרה שיטתית, מטופל יכול לעבור למתחרה גם אחרי ביקור ראשון טוב.",
			metrics: { reactivated: 47, revenue: 174000, chairs: 79 },
		},
		{
			stage: "owner",
			chatStep: 7,
			title: "8. הבעלים רואה את כל המשפך",
			what: "הבעלים רואה כמה מטופלים בעבודה, כמה ענו, כמה קבעו תור ואיפה צריך אדם.",
			benefit: "החלטות הרחבה מתקבלות לפי מספרים, לא לפי תחושות של הצוות.",
			why: "אם המקטע הראשון מביא תורים, אפשר להרחיב שלב אחרי שלב בלי לסכן את כל המאגר.",
			metrics: { reactivated: 50, revenue: 186000, chairs: 82 },
		},
		{
			stage: "pilot",
			chatStep: 7,
			title: "9. הצעד הבא לקליניקה שלכם",
			what: "אפשר להתחיל עם 50 מטופלים וחלונות התורים הפנויים הראשונים.",
			benefit: "הקליניקה רואה תגובות, תורים וכלכלה לפני הרחבה לכל המאגר.",
			why: "פיילוט של 7 ימים מוריד סיכון ומראה מהר אם כדאי להרחיב.",
			metrics: { reactivated: 50, revenue: 186000, chairs: 82 },
		},
	],
};

const uiText = {
	ru: {
		anna: "Анна",
		play: "Играть",
	pause: "Пауза",
		returned: "Вернули",
		averageCheck: "При среднем чеке",
		ownerRevenue: "ожидаемый доход",
		heroTitle: (amount) => `У вас уже есть +${amount} в базе. Вы просто их не забрали.`,
		markets: { il: "Израиль", us: "США", eu: "Европа", ru: "Россия" },
	},
	en: {
		anna: "Anna",
		play: "Play",
		pause: "Pause",
		returned: "Returned",
		averageCheck: "At average ticket",
		ownerRevenue: "expected revenue",
		heroTitle: (amount) => `You already have +${amount} in your database. You just have not collected it.`,
		markets: { il: "Israel", us: "USA", eu: "Europe", ru: "Russia" },
	},
	he: {
		anna: "אנה",
		play: "נגן",
		pause: "השהה",
		returned: "חזרו",
		averageCheck: "בצ'ק ממוצע",
		ownerRevenue: "הכנסה צפויה",
		heroTitle: (amount) => `כבר יש לכם +${amount} במאגר. פשוט עוד לא לקחתם אותו.`,
		markets: { il: "ישראל", us: "ארה״ב", eu: "אירופה", ru: "רוסיה" },
	},
};

const staticTexts = {
	"Демо для премиум-клиники": {
		en: "Demo for a premium clinic",
		he: "הדגמה לקליניקת פרימיום",
	},
	Сбросить: { en: "Reset", he: "איפוס" },
	"Показать всю презентацию": { en: "Show full presentation", he: "להציג את כל המצגת" },
	"Показать диалог с пациентом": { en: "Show patient dialog", he: "להציג שיחה עם מטופל" },
	Предложение: { en: "Offer", he: "הצעה" },
	"Сколько денег спит в вашей базе пациентов?": {
		en: "How much money is sleeping in your patient database?",
		he: "כמה כסף ישן במאגר המטופלים שלכם?",
	},
	"Показываем не абстрактную систему, а путь возврата денег: база, первые 50 пациентов, переписка, запись, врач и повторный визит.": {
		en: "We show a money-return path, not an abstract system: database, first 50 patients, conversation, booking, doctor, and repeat visit.",
		he: "אנחנו מציגים מסלול להחזרת כסף, לא מערכת מופשטת: מאגר, 50 מטופלים ראשונים, שיחה, תור, רופא וביקור חוזר.",
	},
	"пациентов вернули": { en: "patients returned", he: "מטופלים חזרו" },
	"прогноз выручки": { en: "revenue forecast", he: "תחזית הכנסה" },
	"загрузка кресел": { en: "chair utilization", he: "ניצול כיסאות" },
	Деньги: { en: "Money", he: "כסף" },
	Сейчас: { en: "Now", he: "היום" },
	"50 пациентов": { en: "50 patients", he: "50 מטופלים" },
	Диалог: { en: "Dialog", he: "שיחה" },
	Страница: { en: "Page", he: "עמוד" },
	Врач: { en: "Doctor", he: "רופא" },
	Возврат: { en: "Return", he: "חזרה" },
	Владелец: { en: "Owner", he: "בעלים" },
	"Быстрый расчет": { en: "Quick calculation", he: "חישוב מהיר" },
	"Даже 5% возврата дают ощутимую выручку": {
		en: "Even a 5% return creates meaningful revenue",
		he: "גם חזרה של 5% מייצרת הכנסה משמעותית",
	},
	"Пациентов в базе": { en: "Patients in database", he: "מטופלים במאגר" },
	"Не были 6 месяцев": { en: "Inactive for 6 months", he: "לא הגיעו 6 חודשים" },
	"Вернем, %": { en: "Return, %", he: "נחזיר, %" },
	"Средний чек": { en: "Average ticket", he: "צ'ק ממוצע" },
	"Главная мысль:": { en: "Main point:", he: "הנקודה המרכזית:" },
	"сначала проверяем деньги в текущей базе, а не увеличиваем расходы на рекламу.": {
		en: "first test the money in the current database, instead of increasing ad spend.",
		he: "קודם בודקים את הכסף במאגר הקיים, לא מגדילים תקציב פרסום.",
	},
	"Как часто сейчас": { en: "What often happens now", he: "מה קורה היום" },
	"Пациент пропадает между касаниями": { en: "The patient disappears between touchpoints", he: "המטופל נעלם בין נקודות המגע" },
	"Администратор отвечает вручную и забывает вернуться.": {
		en: "The admin replies manually and forgets to follow up.",
		he: "מנהל הקבלה עונה ידנית ושוכח לחזור.",
	},
	"Пациент получает общий список цен и откладывает решение.": {
		en: "The patient gets a general price list and delays the decision.",
		he: "המטופל מקבל מחירון כללי ודוחה החלטה.",
	},
	"Врач начинает консультацию без контекста.": {
		en: "The doctor starts the consultation without context.",
		he: "הרופא מתחיל ייעוץ בלי הקשר.",
	},
	"После визита нет системного возврата.": {
		en: "There is no systematic return after the visit.",
		he: "אין חזרה שיטתית אחרי הביקור.",
	},
	"С LINDA OS": { en: "With LINDA OS", he: "עם LINDA OS" },
	"Каждый пациент ведется по плану": { en: "Every patient follows a plan", he: "כל מטופל מתקדם לפי תוכנית" },
	"Система сама уточняет цель, страхи и бюджет.": {
		en: "The system clarifies the goal, fears, and budget.",
		he: "המערכת מבררת מטרה, חששות ותקציב.",
	},
	"Пациент получает личную рекомендацию и время записи.": {
		en: "The patient gets a personal recommendation and booking time.",
		he: "המטופל מקבל המלצה אישית ושעת תור.",
	},
	"Врач заранее видит короткое досье.": {
		en: "The doctor sees a short profile in advance.",
		he: "הרופא רואה פרופיל קצר מראש.",
	},
	"После визита система возвращает пациента на следующий шаг.": {
		en: "After the visit, the system brings the patient to the next step.",
		he: "אחרי הביקור המערכת מחזירה את המטופל לשלב הבא.",
	},
	"Первые 50 пациентов": { en: "First 50 patients", he: "50 המטופלים הראשונים" },
	"Запуск возврата без тяжелого внедрения": {
		en: "Launch returns without heavy implementation",
		he: "הפעלת חזרה בלי הטמעה כבדה",
	},
	"Запустить возврат": { en: "Launch return", he: "להפעיל החזרה" },
	"выбрано из базы": { en: "selected from database", he: "נבחרו מהמאגר" },
	"сообщений подготовлено": { en: "messages prepared", he: "הודעות הוכנו" },
	"нужно утвердить": { en: "need approval", he: "דורשים אישור" },
	"уже записались": { en: "already booked", he: "כבר קבעו" },
	"Переписка": { en: "Conversation", he: "התכתבות" },
	"LINDA активна": { en: "LINDA active", he: "LINDA פעילה" },
	"Персональная страница": { en: "Personal page", he: "עמוד אישי" },
	"Анна, вам подойдет мягкая коррекция без перегруза": {
		en: "Anna, gentle correction without overload fits you",
		he: "אנה, מתאים לך תיקון עדין בלי עומס",
	},
	"Учитываем страх боли, желание натурального эффекта и средний+ бюджет. Врач получает уже подготовленного клиента, а не холодный запрос.": {
		en: "We account for pain concern, natural-result preference, and mid+ budget. The doctor gets a prepared client, not a cold request.",
		he: "אנחנו מתחשבים בחשש מכאב, רצון לתוצאה טבעית ותקציב בינוני+. הרופא מקבל לקוחה מוכנה, לא פנייה קרה.",
	},
	Консультация: { en: "Consultation", he: "ייעוץ" },
	"30 минут с врачом-косметологом, подтверждение показаний и плана.": {
		en: "30 minutes with an aesthetic doctor to confirm indications and plan.",
		he: "30 דקות עם רופא אסתטי לאישור התאמה ותוכנית.",
	},
	"Мягкая коррекция": { en: "Gentle correction", he: "תיקון עדין" },
	"Натуральный эффект, минимальный отек, контроль боли.": {
		en: "Natural effect, minimal swelling, pain control.",
		he: "תוצאה טבעית, נפיחות מינימלית, שליטה בכאב.",
	},
	"Домашний уход": { en: "Home care", he: "טיפול ביתי" },
	"Средства для восстановления в нужный момент, без случайного допродажа.": {
		en: "Recovery products at the right time, without random upselling.",
		he: "מוצרי התאוששות בזמן הנכון, בלי מכירה מקרית.",
	},
	"Экран врача": { en: "Doctor screen", he: "מסך רופא" },
	"Досье перед приемом": { en: "Profile before the visit", he: "פרופיל לפני הביקור" },
	"5 минут до визита": { en: "5 minutes before visit", he: "5 דקות לפני הביקור" },
	Цель: { en: "Goal", he: "מטרה" },
	"Улучшить лицо без заметной искусственности": {
		en: "Improve the face without obvious artificiality",
		he: "לשפר את הפנים בלי מראה מלאכותי ברור",
	},
	Страх: { en: "Concern", he: "חשש" },
	"Боль, отеки, \"утиные губы\"": { en: "Pain, swelling, unnatural lips", he: "כאב, נפיחות, שפתיים לא טבעיות" },
	Бюджет: { en: "Budget", he: "תקציב" },
	"Средний+": { en: "Mid+", he: "בינוני+" },
	Готовность: { en: "Readiness", he: "מוכנות" },
	"К курсу процедур на 12 месяцев": { en: "For a 12-month treatment plan", he: "לתוכנית טיפולים ל-12 חודשים" },
	"Подсказки врачу": { en: "Doctor prompts", he: "הנחיות לרופא" },
	"Начать с безопасности и контроля боли.": { en: "Start with safety and pain control.", he: "להתחיל מבטיחות ושליטה בכאב." },
	"Показать естественный результат через 2-3 недели.": {
		en: "Show the natural result in 2-3 weeks.",
		he: "להראות תוצאה טבעית אחרי 2-3 שבועות.",
	},
	"Предложить годовой план, а не разовый укол.": {
		en: "Offer a yearly plan, not a one-time injection.",
		he: "להציע תוכנית שנתית, לא הזרקה חד-פעמית.",
	},
	"Утвердить план": { en: "Approve plan", he: "לאשר תוכנית" },
	"День 3": { en: "Day 3", he: "יום 3" },
	"Контроль восстановления": { en: "Recovery check", he: "בדיקת החלמה" },
	"LINDA спрашивает про отек, боль и самочувствие. При риске передает администратору.": {
		en: "LINDA asks about swelling, pain, and wellbeing. If there is risk, it passes to the admin.",
		he: "LINDA שואלת על נפיחות, כאב והרגשה. במקרה סיכון היא מעבירה למנהל הקבלה.",
	},
	"День 14": { en: "Day 14", he: "יום 14" },
	"Уход в нужный момент": { en: "Care at the right time", he: "טיפול בזמן הנכון" },
	"Пациент получает персональную рекомендацию, врач заранее ее утвердил.": {
		en: "The patient gets a personal recommendation approved by the doctor in advance.",
		he: "המטופל מקבל המלצה אישית שהרופא אישר מראש.",
	},
	"Месяц 3": { en: "Month 3", he: "חודש 3" },
	"Повторная запись": { en: "Repeat booking", he: "תור חוזר" },
	"Система возвращает пациента, пока он не ушел к конкуренту.": {
		en: "The system brings the patient back before they go to a competitor.",
		he: "המערכת מחזירה את המטופל לפני שהוא עובר למתחרה.",
	},
	"Экран владельца": { en: "Owner screen", he: "מסך בעלים" },
	"Видно, где деньги и где нужен человек": {
		en: "See where the money is and where a human is needed",
		he: "רואים איפה הכסף ואיפה צריך אדם",
	},
	"7 дней запуска": { en: "7 days of launch", he: "7 ימי הפעלה" },
	"пациентов в запуске": { en: "patients in launch", he: "מטופלים בהפעלה" },
	ответили: { en: "replied", he: "ענו" },
	записей: { en: "bookings", he: "תורים" },
	"ожидаемый доход, ₪": { en: "expected revenue, ₪", he: "הכנסה צפויה, ₪" },
	"Нужно утвердить": { en: "Needs approval", he: "דורש אישור" },
	"12 сообщений, где лучше участие администратора или врача.": {
		en: "12 messages where an admin or doctor should be involved.",
		he: "12 הודעות שבהן עדיף לערב מנהל קבלה או רופא.",
	},
	"Свободные окна": { en: "Available times", he: "זמנים פנויים" },
	"Пятница 12:30, пятница 17:00, воскресенье 11:00.": {
		en: "Friday 12:30, Friday 17:00, Sunday 11:00.",
		he: "שישי 12:30, שישי 17:00, ראשון 11:00.",
	},
	"Следующий шаг": { en: "Next step", he: "השלב הבא" },
	"Подключить еще 150 пациентов, если первые 50 дали записи.": {
		en: "Connect another 150 patients if the first 50 produced bookings.",
		he: "לחבר עוד 150 מטופלים אם 50 הראשונים יצרו תורים.",
	},
	"Как это работает": { en: "How it works", he: "איך זה עובד" },
	"Где деньги в базе": { en: "Where the money is in the database", he: "איפה הכסף במאגר" },
	"Что происходит": { en: "What happens", he: "מה קורה" },
	"Клиника видит, сколько денег можно вернуть из текущей базы.": {
		en: "The clinic sees how much money can be recovered from the current database.",
		he: "הקליניקה רואה כמה כסף אפשר להחזיר מהמאגר הקיים.",
	},
	"Что это даёт клинике": { en: "What it gives the clinic", he: "מה זה נותן לקליניקה" },
	"Появляется прогноз выручки без роста рекламного бюджета.": {
		en: "There is a revenue forecast without increasing the ad budget.",
		he: "נוצרת תחזית הכנסה בלי להגדיל תקציב פרסום.",
	},
	"Почему это важно": { en: "Why it matters", he: "למה זה חשוב" },
	"Решение принимается по цифрам, а не по ощущениям.": {
		en: "The decision is made from numbers, not feelings.",
		he: "ההחלטה מתקבלת לפי מספרים, לא לפי תחושות.",
	},
	Назад: { en: "Back", he: "אחורה" },
	Играть: { en: "Play", he: "נגן" },
	Дальше: { en: "Next", he: "הבא" },
	"Контроль и безопасность": { en: "Control and safety", he: "בקרה ובטיחות" },
	"Клиника сохраняет контроль": { en: "The clinic stays in control", he: "הקליניקה נשארת בשליטה" },
	"На связи": { en: "Online", he: "מחובר" },
	"Человек может подключиться в любой момент": {
		en: "A human can step in at any moment",
		he: "אדם יכול להצטרף בכל רגע",
	},
	"Рекомендации можно утверждать перед отправкой": {
		en: "Recommendations can be approved before sending",
		he: "אפשר לאשר המלצות לפני שליחה",
	},
	"Данные клиники изолированы": { en: "Clinic data is isolated", he: "נתוני הקליניקה מבודדים" },
	"Черновик ответа": { en: "Draft reply", he: "טיוטת תשובה" },
	"Анна, по вашим ответам лучше начать с консультации и мягкой коррекции. Есть окно в пятницу в 12:30. Забронировать?": {
		en: "Anna, based on your answers, it is best to start with a consultation and gentle correction. Friday at 12:30 is available. Book it?",
		he: "אנה, לפי התשובות שלך עדיף להתחיל בייעוץ ותיקון עדין. יש זמן פנוי ביום שישי ב-12:30. לקבוע?",
	},
	Одобрить: { en: "Approve", he: "לאשר" },
	"Что получает владелец": { en: "What the owner gets", he: "מה הבעלים מקבל" },
	"первые записи из текущей базы": { en: "first bookings from the current database", he: "תורים ראשונים מהמאגר הקיים" },
	"Меньше ручной работы": { en: "Less manual work", he: "פחות עבודה ידנית" },
	"администратор подключается только там, где нужен человек": {
		en: "the admin steps in only where a human is needed",
		he: "מנהל הקבלה מצטרף רק איפה שצריך אדם",
	},
	"Без роста рекламы": { en: "No ad growth", he: "בלי להגדיל פרסום" },
	"повторная выручка из уже собранной базы": {
		en: "repeat revenue from the database already collected",
		he: "הכנסה חוזרת מהמאגר שכבר נאסף",
	},
	Израиль: { en: "Israel", he: "ישראל" },
	США: { en: "USA", he: "ארה״ב" },
	Европа: { en: "Europe", he: "אירופה" },
	Россия: { en: "Russia", he: "רוסיה" },
	"Показываем не систему, а понятный путь к первым записям: база, первые 50 пациентов, переписка, запись, врач, повторный визит и решение для владельца.": {
		en: "We show a clear path to first bookings, not a system: database, first 50 patients, conversation, booking, doctor, repeat visit, and the owner's decision.",
		he: "אנחנו מציגים מסלול ברור לתורים ראשונים, לא מערכת: מאגר, 50 מטופלים ראשונים, שיחה, תור, רופא, ביקור חוזר והחלטת הבעלים.",
	},
	"Без рекламы": { en: "No advertising", he: "בלי פרסום" },
	"Без найма": { en: "No hiring", he: "בלי גיוס עובדים" },
	"7 дней до первых записей": { en: "7 days to first bookings", he: "7 ימים עד התורים הראשונים" },
	Пилот: { en: "Pilot", he: "פיילוט" },
	"Даже небольшой возврат дает ощутимую выручку": {
		en: "Even a small return creates meaningful revenue",
		he: "גם חזרה קטנה מייצרת הכנסה משמעותית",
	},
	"Консервативно 3%": { en: "Conservative 3%", he: "שמרני 3%" },
	"Реалистично 5%": { en: "Realistic 5%", he: "ריאלי 5%" },
	"Агрессивно 10%": { en: "Aggressive 10%", he: "אגרסיבי 10%" },
	"В 90% клиник неактивных пациентов 25-40%": {
		en: "In 90% of clinics, inactive patients are 25-40%",
		he: "ב-90% מהקליניקות 25-40% מהמטופלים אינם פעילים",
	},
	"Вы теряете пациентов каждый день": {
		en: "You lose patients every day",
		he: "אתם מאבדים מטופלים כל יום",
	},
	"Вы теряете пациентов каждый день.": {
		en: "You lose patients every day.",
		he: "אתם מאבדים מטופלים כל יום.",
	},
	"Вы платите за рекламу, пока база простаивает.": {
		en: "You pay for ads while the database sits idle.",
		he: "אתם משלמים על פרסום בזמן שהמאגר עומד.",
	},
	"Врач продает вслепую.": {
		en: "The doctor sells blind.",
		he: "הרופא מוכר בעיניים עצומות.",
	},
	"После визита пациент уходит без следующего шага.": {
		en: "After the visit, the patient leaves without a next step.",
		he: "אחרי הביקור המטופל יוצא בלי צעד הבא.",
	},
	"Запущено 2 часа назад": { en: "Launched 2 hours ago", he: "הופעל לפני שעתיים" },
	"+1 ответ": { en: "+1 reply", he: "+תגובה 1" },
	"+1 запись": { en: "+1 booking", he: "+תור 1" },
	"Обычное сообщение": { en: "Generic message", he: "הודעה רגילה" },
	"Пациент игнорирует": { en: "Patient ignores it", he: "המטופל מתעלם" },
	"“Здравствуйте, отправляем прайс. Запишитесь, если актуально.”": {
		en: "“Hello, sending the price list. Book if relevant.”",
		he: "״שלום, שולחים מחירון. תקבעו אם רלוונטי.״",
	},
	"Пациент отвечает": { en: "Patient replies", he: "המטופל עונה" },
	"Сначала снимаем страх, потом предлагаем конкретное окно.": {
		en: "First we handle the fear, then offer a concrete slot.",
		he: "קודם מורידים חשש, ואז מציעים חלון זמן מדויק.",
	},
	"Что НЕ говорить пациенту": { en: "What NOT to say to the patient", he: "מה לא להגיד למטופל" },
	"“Вам надо сделать вот это, цена такая.”": {
		en: "“You need this procedure, here is the price.”",
		he: "״את צריכה את הטיפול הזה, זה המחיר.״",
	},
	"Что сказать, чтобы закрыть на план": {
		en: "What to say to close on a plan",
		he: "מה להגיד כדי לסגור על תוכנית",
	},
	"“Начнем мягко, проверим реакцию и закрепим результат по плану на 12 месяцев.”": {
		en: "“We will start gently, check the response, and lock in the result with a 12-month plan.”",
		he: "״נתחיל בעדינות, נבדוק תגובה ונקבע תוצאה בתוכנית של 12 חודשים.״",
	},
	"повторных визитов": { en: "repeat visits", he: "ביקורים חוזרים" },
	"LTV пациента": { en: "patient LTV", he: "LTV של מטופל" },
	Риск: { en: "Risk", he: "סיכון" },
	"без этого пациент уходит к конкуренту": {
		en: "without this, the patient goes to a competitor",
		he: "בלי זה המטופל עובר למתחרה",
	},
	"Это только 50 пациентов из 1200": {
		en: "This is only 50 patients out of 1200",
		he: "אלה רק 50 מטופלים מתוך 1200",
	},
	"Если первые 50 дали записи, масштабируем запуск на всю неактивную базу.": {
		en: "If the first 50 produce bookings, scale the launch to the entire inactive base.",
		he: "אם 50 הראשונים מייצרים תורים, מרחיבים לכל המאגר הלא פעיל.",
	},
	"Запустить на всей базе": { en: "Launch on the full database", he: "להפעיל על כל המאגר" },
	"Финальный оффер": { en: "Final offer", he: "הצעה סופית" },
	"Следующий шаг для вашей клиники": {
		en: "The next step for your clinic",
		he: "הצעד הבא לקליניקה שלכם",
	},
	"Запуск можно начать с небольшого сегмента базы. Это позволяет увидеть ответы, записи и экономику до масштабирования на всю клинику.": {
		en: "The launch can start with a small database segment. This lets the clinic see replies, bookings, and economics before scaling to the whole clinic.",
		he: "אפשר להתחיל את ההפעלה ממקטע קטן במאגר. כך רואים תגובות, תורים וכלכלה לפני הרחבה לכל הקליניקה.",
	},
	"Старт с 50 пациентов": { en: "Start with 50 patients", he: "התחלה עם 50 מטופלים" },
	"берем небольшой сегмент неактивной базы": {
		en: "take a small inactive database segment",
		he: "לוקחים מקטע קטן מהמאגר הלא פעיל",
	},
	"Первые результаты за 7 дней": { en: "First results in 7 days", he: "תוצאות ראשונות ב-7 ימים" },
	"смотрим ответы, записи и свободные окна": {
		en: "track replies, bookings, and available slots",
		he: "בודקים תגובות, תורים וחלונות פנויים",
	},
	"Масштабирование после результата": {
		en: "Scale after confirmed result",
		he: "מרחיבים אחרי תוצאה מאושרת",
	},
	"расширяем запуск только после подтвержденной экономики": {
		en: "expand only after the economics are confirmed",
		he: "מרחיבים רק אחרי שהכלכלה הוכחה",
	},
	"Запускаем на 50 пациентах за 7 дней": {
		en: "Launch on 50 patients in 7 days",
		he: "מפעילים על 50 מטופלים ב-7 ימים",
	},
	"Не продаем “AI систему”. Продаем проверку: сколько денег клиника может вернуть из своей базы без увеличения рекламного бюджета.": {
		en: "We do not sell an “AI system”. We sell a test: how much money the clinic can recover from its database without increasing the ad budget.",
		he: "אנחנו לא מוכרים ״מערכת AI״. אנחנו מוכרים בדיקה: כמה כסף הקליניקה יכולה להחזיר מהמאגר בלי להגדיל תקציב פרסום.",
	},
	"Без интеграции": { en: "No integration", he: "בלי אינטגרציה" },
	"стартуем на выгрузке базы и свободных окнах": {
		en: "start from a database export and available slots",
		he: "מתחילים מייצוא מאגר וחלונות פנויים",
	},
	"Без риска": { en: "No risk", he: "בלי סיכון" },
	"администратор утверждает чувствительные сообщения": {
		en: "the admin approves sensitive messages",
		he: "מנהל הקבלה מאשר הודעות רגישות",
	},
	"Оплата за результат": { en: "Pay for result", he: "תשלום לפי תוצאה" },
	"платите только если есть записи": {
		en: "pay only if there are bookings",
		he: "משלמים רק אם יש תורים",
	},
	"Запустить пилот": { en: "Launch pilot", he: "להפעיל פיילוט" },
};

const state = {
	step: 0,
	stage: "patient",
	presentationStep: 0,
	presentationRunning: false,
	presentationTimer: undefined,
	mode: new URLSearchParams(window.location.search).get("mode") === "presenter" ? "presenter" : "client",
	market: "il",
	language: "ru",
	metrics: {
		reactivated: 0,
		revenue: 0,
		chairs: 0,
	},
};

const chatThread = document.querySelector("#chatThread");
const quickReplies = document.querySelector("#quickReplies");
const stageTabs = [...document.querySelectorAll(".stage-tab")];
const stagePanels = [...document.querySelectorAll(".stage-panel")];
const startDemo = document.querySelector("#startDemo");
const startPresentation = document.querySelector("#startPresentation");
const resetDemo = document.querySelector("#resetDemo");
const languageButtons = [...document.querySelectorAll(".language-button")];
const marketLabel = document.querySelector("#marketLabel");
const marketButtons = [...document.querySelectorAll(".market-button")];
const riskButtons = [...document.querySelectorAll(".risk-button")];
const basePatientsInput = document.querySelector("#basePatientsInput");
const inactivePatientsInput = document.querySelector("#inactivePatientsInput");
const returnRateInput = document.querySelector("#returnRateInput");
const averageCheckInput = document.querySelector("#averageCheckInput");
const heroRevenueTitle = document.querySelector("#heroRevenueTitle");
const basePatientsValue = document.querySelector("#basePatientsValue");
const inactivePatientsValue = document.querySelector("#inactivePatientsValue");
const returnRateLabel = document.querySelector("#returnRateLabel");
const returnedPatientsValue = document.querySelector("#returnedPatientsValue");
const averageCheckLabel = document.querySelector("#averageCheckLabel");
const forecastRevenueValue = document.querySelector("#forecastRevenueValue");
const formulaLine = document.querySelector("#formulaLine");
const ownerRevenueValue = document.querySelector("#ownerRevenueValue");
const ownerRevenueLabel = document.querySelector("#ownerRevenueLabel");
const insightTitle = document.querySelector("#insightTitle");
const insightWhat = document.querySelector("#insightWhat");
const insightBenefit = document.querySelector("#insightBenefit");
const insightWhy = document.querySelector("#insightWhy");
const insightCounter = document.querySelector("#insightCounter");
const insightProgress = document.querySelector("#insightProgress");
const togglePresentation = document.querySelector("#togglePresentation");
const previousPresentationStep = document.querySelector("#previousPresentationStep");
const nextPresentationStep = document.querySelector("#nextPresentationStep");
const reactivatedMetric = document.querySelector("#reactivatedMetric");
const revenueMetric = document.querySelector("#revenueMetric");
const chairsMetric = document.querySelector("#chairsMetric");

const normalizeText = (value) => value.replace(/\s+/g, " ").trim();

const findStaticTextKey = (text) => {
	const normalized = normalizeText(text);
	for (const [key, translations] of Object.entries(staticTexts)) {
		if (normalizeText(key) === normalized) return key;
		if (Object.values(translations).some((translation) => normalizeText(translation) === normalized)) return key;
	}
	return undefined;
};

const translateStaticText = (language) => {
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	const nodes = [];
	while (walker.nextNode()) {
		nodes.push(walker.currentNode);
	}

	for (const node of nodes) {
		const value = node.nodeValue ?? "";
		if (!value.trim()) continue;
		const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
		if (!match) continue;
		const key = findStaticTextKey(match[2]);
		if (!key) continue;
		const replacement = language === "ru" ? key : staticTexts[key][language];
		if (replacement) {
			node.nodeValue = `${match[1]}${replacement}${match[3]}`;
		}
	}
};

const setLanguage = (language) => {
	state.language = language;
	chatSteps = localizedChatSteps[language];
	presentationSteps = localizedPresentationSteps[language];
	document.documentElement.lang = language;
	document.documentElement.dir = language === "he" ? "rtl" : "ltr";
	languageButtons.forEach((button) => button.classList.toggle("active", button.dataset.language === language));
	translateStaticText(language);
	renderChat();
	updateMetrics();
	renderInsight();
	updateMoneyCalculator();
};

const formatNumber = (value) => value.toLocaleString("ru-RU");

const formatCurrency = (value) => {
	const preset = marketPresets[state.market];
	const formatted = value.toLocaleString("ru-RU");
	return preset.suffix ? `${formatted} ${preset.currency}` : `${preset.currency}${formatted}`;
};

const formatCurrencyCompact = (value) => {
	const preset = marketPresets[state.market];
	const formatted = value.toLocaleString("ru-RU");
	if (state.market === "il") return `₪${formatted}`;
	return preset.suffix ? `${formatted}${preset.currency}` : `${preset.currency}${formatted}`;
};

const formatCurrencyForPitch = (value) => {
	const preset = marketPresets[state.market];
	const formatted = value.toLocaleString("ru-RU");
	if (state.market === "il") return `₪${formatted}`;
	return preset.suffix ? `${formatted} ${preset.currency}` : `${preset.currency}${formatted}`;
};

const setCurrencyElement = (element, value) => {
	element.textContent = formatCurrency(value);
};

const animateNumberText = (element, target) => {
	const start = 0;
	const duration = 700;
	const startedAt = performance.now();

	const step = (timestamp) => {
		const progress = Math.min(1, (timestamp - startedAt) / duration);
		const eased = 1 - (1 - progress) ** 3;
		element.textContent = formatNumber(Math.round(start + (target - start) * eased));
		if (progress < 1) {
			window.requestAnimationFrame(step);
		}
	};

	window.requestAnimationFrame(step);
};

const getPositiveNumber = (input, fallback) => {
	const value = Number(input.value);
	return Number.isFinite(value) && value > 0 ? value : fallback;
};

const updateMoneyCalculator = () => {
	const preset = marketPresets[state.market];
	const ui = uiText[state.language];
	const basePatients = Math.round(getPositiveNumber(basePatientsInput, 4000));
	const inactivePatients = Math.round(getPositiveNumber(inactivePatientsInput, 1200));
	const returnRate = Math.max(1, Math.min(30, Math.round(getPositiveNumber(returnRateInput, 5))));
	const averageCheck = Math.round(getPositiveNumber(averageCheckInput, preset.averageCheck));
	const returnedPatients = Math.round((inactivePatients * returnRate) / 100);
	const forecastRevenue = returnedPatients * averageCheck;
	const ownerRevenue = 7 * averageCheck;

	marketLabel.textContent = ui.markets[state.market];
	basePatientsValue.textContent = formatNumber(basePatients);
	inactivePatientsValue.textContent = formatNumber(inactivePatients);
	returnRateLabel.textContent = `${ui.returned} ${returnRate}%`;
	returnedPatientsValue.textContent = formatNumber(returnedPatients);
	averageCheckLabel.textContent = `${ui.averageCheck} ${formatCurrency(averageCheck)}`;
	animateNumberText(forecastRevenueValue, forecastRevenue);
	heroRevenueTitle.textContent = ui.heroTitle(formatCurrencyForPitch(forecastRevenue));
	formulaLine.textContent = `${formatNumber(inactivePatients)} × ${returnRate}% × ${formatCurrencyCompact(averageCheck)} = ${formatCurrencyForPitch(forecastRevenue)}`;
	ownerRevenueValue.textContent = formatNumber(ownerRevenue);
	ownerRevenueLabel.textContent = `${ui.ownerRevenue}, ${preset.currency}`;
	riskButtons.forEach((button) => button.classList.toggle("active", Number(button.dataset.rate) === returnRate));
};

const setStage = (stage, options = { syncInsight: true }) => {
	state.stage = stage;
	stageTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.stage === stage));
	stagePanels.forEach((panel) => panel.classList.toggle("active", panel.id === `${stage}Stage`));
	if (options.syncInsight) {
		const index = presentationSteps.findIndex((step) => step.stage === stage);
		if (index >= 0) {
			state.presentationStep = index;
			state.step = Math.min(state.step, presentationSteps[index].chatStep);
			state.metrics = { ...presentationSteps[index].metrics };
			updateMetrics();
			renderInsight();
		}
	}
};

const updateMetrics = () => {
	reactivatedMetric.textContent = String(state.metrics.reactivated);
	setCurrencyElement(revenueMetric, state.metrics.revenue);
	chairsMetric.textContent = `${state.metrics.chairs}%`;
};

const renderInsight = () => {
	const step = presentationSteps[state.presentationStep];
	insightTitle.textContent = step.title;
	insightWhat.textContent = step.what;
	insightBenefit.textContent = step.benefit;
	insightWhy.textContent = step.why;
	insightCounter.textContent = `${state.presentationStep + 1}/${presentationSteps.length}`;
	togglePresentation.textContent = state.presentationRunning ? uiText[state.language].pause : uiText[state.language].play;
	insightProgress.innerHTML = "";

	for (let index = 0; index < presentationSteps.length; index += 1) {
		const progressStep = document.createElement("div");
		progressStep.className = `progress-step${index <= state.presentationStep ? " active" : ""}`;
		insightProgress.append(progressStep);
	}
};

const animateMetrics = () => {
	state.metrics = {
		reactivated: Math.min(50, state.metrics.reactivated + 7),
		revenue: Math.min(186000, state.metrics.revenue + 26000),
		chairs: Math.min(82, state.metrics.chairs + 12),
	};
	updateMetrics();
};

const renderChat = () => {
	chatThread.innerHTML = "";
	const visibleSteps = chatSteps.slice(0, state.step + 1);

	for (const entry of visibleSteps) {
		const message = document.createElement("div");
		message.className = `message ${entry.role}`;
		message.innerHTML = `<strong>${entry.role === "linda" ? "LINDA" : uiText[state.language].anna}</strong>${entry.text}`;
		chatThread.append(message);
	}

	quickReplies.innerHTML = "";
	const current = chatSteps[state.step];
	for (const reply of current.replies) {
		const button = document.createElement("button");
		button.className = "reply-button";
		button.type = "button";
		button.textContent = reply;
		button.addEventListener("click", nextStep);
		quickReplies.append(button);
	}

	chatThread.scrollTop = chatThread.scrollHeight;
};

const setPresentationStep = (index) => {
	state.presentationStep = Math.max(0, Math.min(presentationSteps.length - 1, index));
	const presentationStep = presentationSteps[state.presentationStep];
	state.step = presentationStep.chatStep;
	state.metrics = { ...presentationStep.metrics };
	setStage(presentationStep.stage, { syncInsight: false });
	renderChat();
	updateMetrics();
	renderInsight();
	updateMoneyCalculator();
};

const stopPresentation = () => {
	if (state.presentationTimer !== undefined) {
		window.clearInterval(state.presentationTimer);
		state.presentationTimer = undefined;
	}
	state.presentationRunning = false;
	renderInsight();
};

const playPresentation = () => {
	stopPresentation();
	state.presentationRunning = true;
	renderInsight();
	state.presentationTimer = window.setInterval(() => {
		if (state.presentationStep >= presentationSteps.length - 1) {
			stopPresentation();
			return;
		}
		setPresentationStep(state.presentationStep + 1);
	}, 10500);
};

const nextStep = () => {
	stopPresentation();
	if (state.step < chatSteps.length - 1) {
		state.step += 1;
		renderChat();
		animateMetrics();
	}

	if (state.step >= 4 && state.stage === "patient") {
		setStage("plan");
	}

	if (state.step >= 7) {
		setStage("doctor");
	}
};

const runFullDemo = () => {
	stopPresentation();
	state.step = 0;
	setStage("patient");
	renderChat();
	updateMetrics();

	let index = 0;
	const interval = window.setInterval(() => {
		if (index >= chatSteps.length - 1) {
			window.clearInterval(interval);
			window.setTimeout(() => setStage("owner"), 900);
			return;
		}
		nextStep();
		index += 1;
	}, 1500);
};

const reset = () => {
	stopPresentation();
	state.step = 0;
	state.presentationStep = 0;
	state.metrics = {
		reactivated: 0,
		revenue: 0,
		chairs: 0,
	};
	setStage("money");
	renderChat();
	updateMetrics();
	renderInsight();
	updateMoneyCalculator();
};

for (const tab of stageTabs) {
	tab.addEventListener("click", () => {
		stopPresentation();
		const stage = tab.dataset.stage;
		if (stages.includes(stage)) {
			setPresentationStep(presentationSteps.findIndex((step) => step.stage === stage));
		}
	});
}

for (const slot of document.querySelectorAll(".slot-button")) {
	slot.addEventListener("click", () => {
		document.querySelectorAll(".slot-button").forEach((button) => button.classList.remove("selected"));
		slot.classList.add("selected");
	});
}

for (const button of marketButtons) {
	button.addEventListener("click", () => {
		const market = button.dataset.market;
		if (!market || !(market in marketPresets)) return;
		state.market = market;
		averageCheckInput.value = String(marketPresets[market].averageCheck);
		marketButtons.forEach((marketButton) => marketButton.classList.toggle("active", marketButton === button));
		updateMetrics();
		updateMoneyCalculator();
	});
}

for (const button of riskButtons) {
	button.addEventListener("click", () => {
		const rate = Number(button.dataset.rate);
		if (!Number.isFinite(rate)) return;
		returnRateInput.value = String(rate);
		riskButtons.forEach((riskButton) => riskButton.classList.toggle("active", riskButton === button));
		updateMoneyCalculator();
	});
}

for (const input of [basePatientsInput, inactivePatientsInput, returnRateInput, averageCheckInput]) {
	input.addEventListener("input", updateMoneyCalculator);
}

for (const button of languageButtons) {
	button.addEventListener("click", () => {
		const language = button.dataset.language;
		if (!language || !(language in localizedChatSteps)) return;
		setLanguage(language);
	});
}

startDemo.addEventListener("click", runFullDemo);
startPresentation.addEventListener("click", () => {
	setPresentationStep(0);
	playPresentation();
});
togglePresentation.addEventListener("click", () => {
	if (state.presentationRunning) {
		stopPresentation();
	} else {
		playPresentation();
	}
});
previousPresentationStep.addEventListener("click", () => {
	stopPresentation();
	setPresentationStep(state.presentationStep - 1);
});
nextPresentationStep.addEventListener("click", () => {
	stopPresentation();
	setPresentationStep(state.presentationStep + 1);
});
resetDemo.addEventListener("click", reset);

document.body.dataset.mode = state.mode;
reset();
