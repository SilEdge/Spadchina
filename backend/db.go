package main

import (
	"database/sql"
	"log"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

var db *sql.DB

func initDB() {
	var err error
	databasePath := strings.TrimSpace(os.Getenv("DATABASE_PATH"))
	if databasePath == "" {
		databasePath = "./cultcode.db"
	}
	db, err = sql.Open("sqlite", databasePath)
	if err != nil {
		log.Fatal(err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	if _, err = db.Exec("PRAGMA busy_timeout = 5000"); err != nil {
		log.Fatal(err)
	}
	if err = db.Ping(); err != nil {
		log.Fatal(err)
	}

	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			name TEXT,
			email TEXT UNIQUE,
			password TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			points INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`ALTER TABLE users ADD COLUMN name TEXT;`,
		`ALTER TABLE users ADD COLUMN email TEXT;`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);`,
		`CREATE TABLE IF NOT EXISTS articles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			category TEXT NOT NULL,
			category_label TEXT NOT NULL,
			difficulty TEXT NOT NULL,
			difficulty_label TEXT NOT NULL,
			read_time INTEGER NOT NULL,
			image TEXT,
			content TEXT NOT NULL,
			questions TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS results (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			article_id INTEGER NOT NULL,
			score INTEGER NOT NULL,
			max_score INTEGER NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (article_id) REFERENCES articles(id),
			UNIQUE(user_id, article_id)
		);`,
		`CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sender_id INTEGER NOT NULL,
			receiver_id INTEGER NOT NULL,
			text TEXT NOT NULL,
			is_read INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (sender_id) REFERENCES users(id),
			FOREIGN KEY (receiver_id) REFERENCES users(id)
		);`,
		`CREATE TABLE IF NOT EXISTS suggestions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT,
			email TEXT,
			message TEXT NOT NULL,
			telegram_delivered INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS duels (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			challenger_id INTEGER NOT NULL,
			opponent_id INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			question_set INTEGER NOT NULL DEFAULT 0,
			questions TEXT NOT NULL,
			challenger_score INTEGER NOT NULL DEFAULT -1,
			opponent_score INTEGER NOT NULL DEFAULT -1,
			winner_id INTEGER,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (challenger_id) REFERENCES users(id),
			FOREIGN KEY (opponent_id) REFERENCES users(id),
			FOREIGN KEY (winner_id) REFERENCES users(id)
		);`,
		`ALTER TABLE duels ADD COLUMN question_set INTEGER NOT NULL DEFAULT 0;`,
		`CREATE TABLE IF NOT EXISTS team_battles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			code TEXT UNIQUE NOT NULL,
			creator_id INTEGER NOT NULL,
			category TEXT NOT NULL,
			category_label TEXT NOT NULL,
			questions TEXT NOT NULL,
			started INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (creator_id) REFERENCES users(id)
		);`,
		`ALTER TABLE team_battles ADD COLUMN started INTEGER NOT NULL DEFAULT 0;`,
		`CREATE TABLE IF NOT EXISTS team_battle_participants (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			battle_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			score INTEGER NOT NULL DEFAULT -1,
			reward_points INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (battle_id) REFERENCES team_battles(id),
			FOREIGN KEY (user_id) REFERENCES users(id),
			UNIQUE(battle_id, user_id)
		);`,
		`ALTER TABLE team_battle_participants ADD COLUMN reward_points INTEGER NOT NULL DEFAULT 0;`,
	}

	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			if strings.Contains(err.Error(), "duplicate column name") {
				continue
			}
			log.Fatal(err)
		}
	}

	_, _ = db.Exec("UPDATE users SET name = username WHERE name IS NULL OR name = ''")
	_, _ = db.Exec("UPDATE users SET email = lower(username || '@local.test') WHERE email IS NULL OR email = ''")

	createAdmin()
	seedArticles()
	seedExpandedArticles()
	normalizeArticleImages()
	ensureTeamBattleQuestionMinimums()
}

func normalizeArticleImages() {
	replacements := map[string]string{
		"https://images.unsplash.com/photo-1565016703295-536a6d7c0e7b?auto=format&fit=crop&w=800&q=80":                                                                                                               "https://upload.wikimedia.org/wikipedia/en/thumb/b/bd/N%C3%A1rodn%C3%AD_knihovna%2C_Minsk_-_panoramio.jpg/250px-N%C3%A1rodn%C3%AD_knihovna%2C_Minsk_-_panoramio.jpg",
		"https://images.unsplash.com/photo-1596484552834-6a58f850e0a1?auto=format&fit=crop&w=800&q=80":                                                                                                               "https://commons.wikimedia.org/wiki/Special:FilePath/%D0%9D%D1%8F%D1%81%D0%B2%D1%96%D0%B6%20%D1%96%20%D0%9D%D1%8F%D1%81%D0%B2%D1%96%D0%B6%D1%81%D0%BA%D1%96%20%D0%B7%D0%B0%D0%BC%D0%B0%D0%BA%2012.jpg",
		"https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=800&q=80":                                                                                                               "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Bialowieza_National_Park_in_Poland0029.JPG/1280px-Bialowieza_National_Park_in_Poland0029.JPG",
		"https://images.unsplash.com/photo-1504700610630-ac6aba3536d3?auto=format&fit=crop&w=800&q=80":                                                                                                               "/images/kupalle.jpg",
		"https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80":                                                                                                               "/images/kupalle.jpg",
		"https://commons.wikimedia.org/wiki/Special:FilePath/Puszcza%20Bia%C5%82owieska%2004.jpg":                                                                                                                    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Bialowieza_National_Park_in_Poland0029.JPG/1280px-Bialowieza_National_Park_in_Poland0029.JPG",
		"https://commons.wikimedia.org/wiki/Special:FilePath/Lake%20Snudy%20in%20Braslaw%20Lakes%20National%20Park.jpg":                                                                                              "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80",
		"https://commons.wikimedia.org/wiki/Special:FilePath/Brest%20Brest%20Fortress%20Kholm%20Gate%209209%202150.jpg":                                                                                              "https://upload.wikimedia.org/wikipedia/commons/5/51/Brest_Brest_Fortress_Kholm_Gate_9209_2150.jpg",
		"https://commons.wikimedia.org/wiki/Special:FilePath/Horadnia%20%28Hrodna%29%2C%20Kalo%C5%BCa.%20%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C%20%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0%20%282021%29%2002.jpg": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Horadnia_%28Hrodna%29%2C_Kalo%C5%BFa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg/1280px-Horadnia_%28Hrodna%29%2C_Kalo%C5%BFa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg",
		"https://upload.wikimedia.org/wikipedia/commons/7/79/Horadnia_%28Hrodna%29%2C%20Kalo%C5%BCa.%20%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C%20%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0%20%282021%29%2002.jpg":   "https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Horadnia_%28Hrodna%29%2C_Kalo%C5%BFa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg/1280px-Horadnia_%28Hrodna%29%2C_Kalo%C5%BFa._%D0%93%D0%BE%D1%80%D0%B0%D0%B4%D0%BD%D1%8F%2C_%D0%9A%D0%B0%D0%BB%D0%BE%D0%B6%D0%B0_%282021%29_02.jpg",
		"https://commons.wikimedia.org/wiki/Special:FilePath/Ruzhany%20Palace%202.jpg":                                                                                                                               "/images/ruzhany-palace.jpg",
		"https://upload.wikimedia.org/wikipedia/commons/a/aa/Belarus_-_Snudy_Lake.jpg":                                                                                                                               "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80",
		"https://commons.wikimedia.org/wiki/Special:FilePath/Mir%20castle%20in%20spring.JPG":                                                                                                                         "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Mir_castle_in_spring.JPG/1280px-Mir_castle_in_spring.JPG",
	}

	for oldURL, newURL := range replacements {
		if _, err := db.Exec("UPDATE articles SET image = ? WHERE image = ?", newURL, oldURL); err != nil {
			log.Printf("article image normalize error: %v", err)
		}
	}
}

func createAdmin() {
	const adminEmail = "n4963959@gmail.com"
	const adminPassword = "admin123"

	hash, _ := bcrypt.GenerateFromPassword([]byte(adminPassword), bcrypt.DefaultCost)
	result, err := db.Exec(`
		UPDATE users
		SET role = 'admin', password = ?
		WHERE lower(email) = ?
	`, string(hash), adminEmail)
	if err != nil {
		log.Fatal(err)
	}

	if rows, _ := result.RowsAffected(); rows == 0 {
		_, err := db.Exec(
			"INSERT INTO users (username, name, email, password, role, points) VALUES (?, ?, ?, ?, ?, ?)",
			"admin", "admin", adminEmail, string(hash), "admin", 0,
		)
		if err != nil {
			log.Fatal(err)
		}
	}

	log.Printf("Admin email: %s, password: %s", adminEmail, adminPassword)
}
