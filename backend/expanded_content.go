package main

import (
	"encoding/json"
	"fmt"
	"log"
)

type placeSeed struct {
	Title, Category, CategoryLabel, Difficulty, DifficultyLabel string
	Region, Image, Summary, Fact                                string
	ReadTime                                                    int
}

// These materials are kept in the backend database so every new card supports
// reading, saved quiz results, progress, duels and team battles.
var expandedPlaces = []placeSeed{
	{"Мирский замок", "history", "История", "medium", "Средний", "Мир, Гродненская область", "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Mir_castle_in_spring.JPG/1280px-Mir_castle_in_spring.JPG", "замковый комплекс, в котором сочетаются готика, ренессанс и оборонная архитектура", "В 2000 году комплекс включили в список Всемирного наследия ЮНЕСКО.", 8},
	{"Брестская крепость", "memorial", "Память", "easy", "Лёгкий", "Брест", "https://upload.wikimedia.org/wikipedia/commons/5/51/Brest_Brest_Fortress_Kholm_Gate_9209_2150.jpg", "мемориальный комплекс, посвящённый защитникам крепости и событиям 1941 года", "В 1965 году крепости присвоили почётное звание «Крепость-герой».", 7},
	{"Коложская церковь", "traditions", "Традиции", "hard", "Сложный", "Гродно", "https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Horadnia_%28Hrodna%29%2C_Kalo%C5%BEa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg/1280px-Horadnia_%28Hrodna%29%2C_Kalo%C5%BEa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg", "один из древнейших храмов страны с цветными камнями и голосниками в стенах", "Борисоглебская церковь относится к XII веку.", 10},
	{"Ружанский дворец", "history", "История", "medium", "Средний", "Ружаны, Брестская область", "/images/ruzhany-palace.jpg", "бывшая резиденция рода Сапег с парадными воротами и большим дворцовым ансамблем", "Сегодня часть комплекса восстановлена и работает как музей.", 8},
	{"Браславские озёра", "nature", "Природа", "easy", "Лёгкий", "Витебская область", "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80", "национальный парк с озёрами, островами, лесами и ледниковыми холмами", "Национальный парк был создан в 1995 году.", 7},
	{"Каменецкая башня", "history", "История", "hard", "Сложный", "Каменец", "/images/kamenets-tower.jpg", "оборонительная башня XIII века, известная под названием Белая вежа", "Башня является редким сохранившимся памятником средневековой оборонной архитектуры.", 10},
	{"Лидский замок", "history", "История", "medium", "Средний", "Лида", "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Mir_castle_in_spring.JPG/1280px-Mir_castle_in_spring.JPG", "кирпичный замок XIV века с двумя башнями и внутренним двором", "Строительство замка связывают с великим князем Гедимином.", 8},
	{"Новогрудский замок", "history", "История", "hard", "Сложный", "Новогрудок", "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Mir_castle_in_spring.JPG/1280px-Mir_castle_in_spring.JPG", "руины средневекового замка на высоком холме, откуда открывается вид на город", "Новогрудок был одним из важных центров ранней истории Великого княжества Литовского.", 10},
	{"Коссовский дворец", "architecture", "Архитектура", "medium", "Средний", "Коссово, Брестская область", "/images/ruzhany-palace.jpg", "неоготический дворец Пусловских с двенадцатью башнями и восстановленными залами", "Рядом находится музей-усадьба Тадеуша Костюшко.", 8},
	{"Гомельский дворец Румянцевых и Паскевичей", "culture", "Культура", "easy", "Лёгкий", "Гомель", "https://commons.wikimedia.org/wiki/Special:FilePath/%D0%9D%D1%8F%D1%81%D0%B2%D1%96%D0%B6%20%D1%96%20%D0%9D%D1%8F%D1%81%D0%B2%D1%96%D0%B6%D1%81%D0%BA%D1%96%20%D0%B7%D0%B0%D0%BC%D0%B0%D0%BA%2012.jpg", "дворцово-парковый ансамбль над Сожем с музейными коллекциями и башней обозрения", "Ансамбль считается главным архитектурным символом Гомеля.", 7},
	{"Витебская ратуша", "architecture", "Архитектура", "easy", "Лёгкий", "Витебск", "https://upload.wikimedia.org/wikipedia/en/thumb/b/bd/N%C3%A1rodn%C3%AD_knihovna%2C_Minsk_-_panoramio.jpg/250px-N%C3%A1rodn%C3%AD_knihovna%2C_Minsk_-_panoramio.jpg", "историческая ратуша в центре города, где сегодня работает краеведческий музей", "Здание напоминает о традициях городского самоуправления и магдебургском праве.", 7},
	{"Дом-музей Марка Шагала", "culture", "Культура", "medium", "Средний", "Витебск", "https://upload.wikimedia.org/wikipedia/en/thumb/b/bd/N%C3%A1rodn%C3%AD_knihovna%2C_Minsk_-_panoramio.jpg/250px-N%C3%A1rodn%C3%AD_knihovna%2C_Minsk_-_panoramio.jpg", "музей, передающий атмосферу детства художника и старого Витебска", "Образы Витебска многократно появлялись в произведениях Марка Шагала.", 8},
	{"Буйничское поле", "memorial", "Память", "medium", "Средний", "Могилёвский район", "https://upload.wikimedia.org/wikipedia/commons/5/51/Brest_Brest_Fortress_Kholm_Gate_9209_2150.jpg", "мемориальный комплекс, посвящённый обороне Могилёва летом 1941 года", "Память о боях на Буйничском поле сохранил в своих произведениях Константин Симонов.", 8},
	{"Бобруйская крепость", "history", "История", "medium", "Средний", "Бобруйск", "https://upload.wikimedia.org/wikipedia/commons/5/51/Brest_Brest_Fortress_Kholm_Gate_9209_2150.jpg", "крупная крепость XIX века с сохранившимися валами, казармами и фрагментами укреплений", "Крепость была одним из важных оборонительных объектов своего времени.", 8},
	{"Туровское городище", "history", "История", "hard", "Сложный", "Туров", "https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Horadnia_%28Hrodna%29%2C_Kalo%C5%BEa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg/1280px-Horadnia_%28Hrodna%29%2C_Kalo%C5%BEa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg", "археологический комплекс на месте одного из древнейших городов Полесья", "Туров был центром самостоятельного княжества и важным духовным центром.", 10},
	{"Припятский национальный парк", "nature", "Природа", "medium", "Средний", "Гомельская область", "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Bialowieza_National_Park_in_Poland0029.JPG/1280px-Bialowieza_National_Park_in_Poland0029.JPG", "заповедное Полесье с поймами Припяти, болотами, дубравами и множеством птиц", "Парк сохраняет один из крупнейших в Европе комплексов пойменных ландшафтов.", 8},
	{"Озеро Нарочь", "nature", "Природа", "easy", "Лёгкий", "Мядельский район", "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80", "самое большое озеро Беларуси, окружённое курортной зоной и сосновыми лесами", "Площадь озера составляет около 80 квадратных километров.", 7},
	{"Августовский канал", "nature", "Природа", "medium", "Средний", "Гродненская область", "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80", "судоходный канал XIX века со шлюзами, лесными берегами и водными маршрутами", "Канал соединил бассейны Вислы и Немана.", 8},
	{"Березинский биосферный заповедник", "nature", "Природа", "hard", "Сложный", "Витебская область", "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Bialowieza_National_Park_in_Poland0029.JPG/1280px-Bialowieza_National_Park_in_Poland0029.JPG", "охраняемая территория с лесами, болотами, озёрами и редкими видами животных", "Заповедник входит во Всемирную сеть биосферных резерватов ЮНЕСКО.", 10},
	{"Жировичский монастырь", "traditions", "Традиции", "medium", "Средний", "Жировичи", "https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Horadnia_%28Hrodna%29%2C_Kalo%C5%BEa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg/1280px-Horadnia_%28Hrodna%29%2C_Kalo%C5%BEa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg", "монастырский ансамбль и один из главных центров православного паломничества страны", "Жировичи известны почитаемой иконой Божией Матери.", 8},
	{"Будславский костёл", "traditions", "Традиции", "medium", "Средний", "Будслав, Минская область", "https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Horadnia_%28Hrodna%29%2C_Kalo%C5%BEa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg/1280px-Horadnia_%28Hrodna%29%2C_Kalo%C5%BEa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg", "монументальный католический храм и центр ежегодного паломничества", "Будславский фест внесён в список нематериального культурного наследия ЮНЕСКО.", 8},
	{"Дудутки", "traditions", "Традиции", "easy", "Лёгкий", "Минская область", "/images/kupalle.jpg", "музейный комплекс, где показывают старинные ремёсла, быт и традиционные технологии", "Посетители могут увидеть работу кузницы, гончарной мастерской и старинной мельницы.", 7},
	{"Строчицы", "traditions", "Традиции", "easy", "Лёгкий", "Минский район", "/images/kupalle.jpg", "музей народной архитектуры и быта под открытым небом", "В музее собраны деревянные постройки из разных историко-этнографических регионов Беларуси.", 7},
	{"Курган Славы", "memorial", "Память", "easy", "Лёгкий", "Смолевичский район", "https://upload.wikimedia.org/wikipedia/commons/5/51/Brest_Brest_Fortress_Kholm_Gate_9209_2150.jpg", "мемориал в честь освобождения Беларуси с высоким земляным курганом и четырьмя штыками", "Четыре штыка символизируют фронты, участвовавшие в операции «Багратион».", 7},
}

func seedExpandedArticles() {
	for index, place := range expandedPlaces {
		var exists int
		_ = db.QueryRow("SELECT COUNT(*) FROM articles WHERE title = ?", place.Title).Scan(&exists)
		if exists > 0 {
			continue
		}

		content, _ := json.Marshal([]map[string]string{
			{"type": "lead", "text": fmt.Sprintf("%s — %s. Место находится в регионе: %s.", place.Title, place.Summary, place.Region)},
			{"type": "paragraph", "text": fmt.Sprintf("Это направление «%s» помогает увидеть, насколько разнообразно наследие Беларуси. %s", place.CategoryLabel, place.Fact)},
			{"type": "fact", "title": "Ключевой факт", "text": place.Fact},
			{"type": "paragraph", "text": fmt.Sprintf("Во время знакомства с объектом обрати внимание на его детали и окружение. Запомни расположение — %s — и главную особенность: %s.", place.Region, place.Summary)},
		})
		questions, _ := json.Marshal(makePlaceQuestions(place, 900000+index*20))
		_, err := db.Exec(
			"INSERT INTO articles (title, category, category_label, difficulty, difficulty_label, read_time, image, content, questions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			place.Title, place.Category, place.CategoryLabel, place.Difficulty, place.DifficultyLabel,
			place.ReadTime, place.Image, string(content), string(questions),
		)
		if err != nil {
			log.Printf("expanded article seed error: %v", err)
		}
	}
}

func makePlaceQuestions(place placeSeed, baseID int) []DuelQuestion {
	return []DuelQuestion{
		{ID: baseID + 1, Type: "single", Question: fmt.Sprintf("Где находится «%s»?", place.Title), Options: []string{place.Region, "Брест", "Минск", "За пределами Беларуси"}, Correct: 0},
		{ID: baseID + 2, Type: "single", Question: fmt.Sprintf("К какой теме относится материал о месте «%s»?", place.Title), Options: []string{place.CategoryLabel, "Спорт", "Технологии", "Космонавтика"}, Correct: 0},
		{ID: baseID + 3, Type: "single", Question: fmt.Sprintf("Что точнее всего описывает «%s»?", place.Title), Options: []string{place.Summary, "современный торговый центр", "промышленное предприятие", "спортивная арена"}, Correct: 0},
		{ID: baseID + 4, Type: "single", Question: "Какой ключевой факт указан в материале?", Options: []string{place.Fact, "Объект построили в XXI веке", "Место находится на морском побережье", "Объект не связан с Беларусью"}, Correct: 0},
		{ID: baseID + 5, Type: "truefalse", Question: fmt.Sprintf("Верно ли, что объект находится в регионе «%s»?", place.Region), Options: []string{"Верно", "Неверно"}, Correct: 0},
		{ID: baseID + 6, Type: "single", Question: "Что полезнее всего сделать во время посещения?", Options: []string{"Рассмотреть детали объекта и его окружение", "Игнорировать исторический контекст", "Не читать информационные материалы", "Оценивать только сувениры"}, Correct: 0},
		{ID: baseID + 7, Type: "single", Question: fmt.Sprintf("Какой уровень сложности у материала «%s»?", place.Title), Options: []string{place.DifficultyLabel, "Не определён", "Только для специалистов", "Материал без заданий"}, Correct: 0},
		{ID: baseID + 8, Type: "single", Question: "Что помогает лучше запомнить достопримечательность?", Options: []string{"Связать название, регион и ключевой факт", "Запомнить только цвет фотографии", "Пропустить описание", "Не отвечать на задания"}, Correct: 0},
		{ID: baseID + 9, Type: "single", Question: fmt.Sprintf("Какая характеристика относится именно к месту «%s»?", place.Title), Options: []string{place.Fact, "Это столица соседнего государства", "Здесь расположен морской порт", "Это вымышленное место"}, Correct: 0},
		{ID: baseID + 10, Type: "single", Question: "Зачем такие места включают в культурный маршрут?", Options: []string{"Чтобы лучше понимать природу, историю и культуру страны", "Только ради соревнований", "Чтобы заменить школьные предметы", "Исключительно ради покупок"}, Correct: 0},
	}
}
