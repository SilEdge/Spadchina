package main

import "time"

type User struct {
	ID        int       `json:"id"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Password  string    `json:"-"`
	Role      string    `json:"role"`
	Points    int       `json:"points"`
	CreatedAt time.Time `json:"created_at"`
}

type Article struct {
	ID              int    `json:"id"`
	Title           string `json:"title"`
	Category        string `json:"category"`
	CategoryLabel   string `json:"categoryLabel"`
	Difficulty      string `json:"difficulty"`
	DifficultyLabel string `json:"difficultyLabel"`
	ReadTime        int    `json:"readTime"`
	Image           string `json:"image"`
	Content         string `json:"content"`   // JSON string
	Questions       string `json:"questions"` // JSON string
}

type ArticleInput struct {
	Title           string `json:"title"`
	Category        string `json:"category"`
	CategoryLabel   string `json:"categoryLabel"`
	Difficulty      string `json:"difficulty"`
	DifficultyLabel string `json:"difficultyLabel"`
	ReadTime        int    `json:"readTime"`
	Image           string `json:"image"`
	Content         string `json:"content"`
	Questions       string `json:"questions"`
}

type Result struct {
	ID        int       `json:"id"`
	UserID    int       `json:"user_id"`
	ArticleID int       `json:"article_id"`
	Score     int       `json:"score"`
	MaxScore  int       `json:"max_score"`
	CreatedAt time.Time `json:"created_at"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Username string `json:"username"` // Backward compatibility for old clients.
	Password string `json:"password"`
}

type RegisterRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Username string `json:"username"` // Backward compatibility for old clients.
	Password string `json:"password"`
}

type TokenResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type LeaderboardEntry struct {
	Username       string `json:"username"`
	Points         int    `json:"points"`
	CompletedCount int    `json:"completed_count"`
	CorrectCount   int    `json:"correct_count"`
}

type ChatMessage struct {
	ID        int    `json:"id"`
	Sender    string `json:"sender"`
	Receiver  string `json:"receiver"`
	Text      string `json:"text"`
	IsRead    bool   `json:"is_read"`
	CreatedAt string `json:"created_at"`
}

type ChatConversation struct {
	Username    string `json:"username"`
	Points      int    `json:"points"`
	LastMessage string `json:"last_message"`
	LastAt      string `json:"last_at"`
	UnreadCount int    `json:"unread_count"`
}

type SendMessageRequest struct {
	To   string `json:"to"`
	Text string `json:"text"`
}

type UnreadResponse struct {
	UnreadCount int `json:"unread_count"`
}

type Duel struct {
	ID              int            `json:"id"`
	ChallengerID    int            `json:"challenger_id"`
	Challenger      string         `json:"challenger"`
	OpponentID      int            `json:"opponent_id"`
	Opponent        string         `json:"opponent"`
	Status          string         `json:"status"`
	QuestionSet     int            `json:"question_set"`
	Questions       []DuelQuestion `json:"questions"`
	ChallengerScore int            `json:"challenger_score"`
	OpponentScore   int            `json:"opponent_score"`
	WinnerID        int            `json:"winner_id"`
	Winner          string         `json:"winner"`
	CreatedAt       string         `json:"created_at"`
	UpdatedAt       string         `json:"updated_at"`
}

type DuelQuestion struct {
	ID            int         `json:"id"`
	Type          string      `json:"type"`
	Question      string      `json:"question"`
	Options       []string    `json:"options"`
	Correct       interface{} `json:"correct"`
	Category      string      `json:"category"`
	CategoryLabel string      `json:"category_label"`
}

type DuelCreateRequest struct {
	Opponent string `json:"opponent"`
}

type DuelAnswer struct {
	QuestionID int   `json:"question_id"`
	Selected   []int `json:"selected"`
	TimeLeft   int   `json:"time_left"`
}

type DuelFinishRequest struct {
	Answers []DuelAnswer `json:"answers"`
}

type TeamBattleCategory struct {
	Category      string `json:"category"`
	CategoryLabel string `json:"category_label"`
	QuestionCount int    `json:"question_count"`
}

type TeamBattle struct {
	ID            int                     `json:"id"`
	Code          string                  `json:"code"`
	Creator       string                  `json:"creator"`
	Category      string                  `json:"category"`
	CategoryLabel string                  `json:"category_label"`
	Questions     []DuelQuestion          `json:"questions"`
	Participants  []TeamBattleParticipant `json:"participants"`
	Started       bool                    `json:"started"`
	CreatedAt     string                  `json:"created_at"`
	UpdatedAt     string                  `json:"updated_at"`
}

type TeamBattleParticipant struct {
	Username     string `json:"username"`
	Score        int    `json:"score"`
	RewardPoints int    `json:"reward_points"`
	Completed    bool   `json:"completed"`
	UpdatedAt    string `json:"updated_at"`
}

type TeamBattleCreateRequest struct {
	Code          string `json:"code"`
	Category      string `json:"category"`
	QuestionCount int    `json:"question_count"`
}

type SuggestionRequest struct {
	Message string `json:"message"`
	Name    string `json:"name"`
	Email   string `json:"email"`
}
