package main

import "time"

type Area struct {
	Id   int
	Name string
	Code string
	Flag string
}

type Competition struct {
	Id     int
	Name   string
	Code   string
	Type   string
	Emblem string
}

type Team struct {
	Id        int
	Name      string
	ShortName string `bson:"short_name"`
	Tla       string
	Crest     string
}

func (t *Team) GetShortName() string {
	switch t.ShortName {
	case "Brighton Hove":
		return "Brighton"
	case "Wolverhampton":
		return "Wolves"
	case "Nottingham":
		return "Notts Forest"
	default:
		return t.ShortName
	}
}

type Season struct {
	Id              int
	StartDate       string `bson:"start_date"`
	EndDate         string `bson:"end_date"`
	CurrentMatchday int    `bson:"current_matchday"`
	Winner          Team
}

type MatchStatus string

const (
	SCHEDULED MatchStatus = "SCHEDULED"
	TIMED     MatchStatus = "TIMED"
	IN_PLAY   MatchStatus = "IN_PLAY"
	PAUSED    MatchStatus = "PAUSED"
	FINISHED  MatchStatus = "FINISHED"
	SUSPENDED MatchStatus = "SUSPENDED"
	POSTPONED MatchStatus = "POSTPONED"
	CANCELLED MatchStatus = "CANCELLED"
	AWARDED   MatchStatus = "AWARDED"
)

type FullTime struct {
	Home int
	Away int
}

type HalfTime struct {
	Home int
	Away int
}

type Score struct {
	Winner   string
	Duration string
	FullTime FullTime `bson:"full_time"`
	HalfTime HalfTime `bson:"half_time"`
}

type Odds struct {
	Msg string `bson:"msg"`
}

type Referee struct {
	Id          int
	Name        string
	Type        string
	Nationality string
}

type Match struct {
	Area        Area
	Competition Competition
	Season      Season
	Id          int
	UtcDate     time.Time `bson:"utc_date"`
	LocalDate   time.Time `bson:"local_date"`
	Status      MatchStatus
	Minute      int
	InjuryTime  int `bson:"injury_time"`
	Matchday    int
	Stage       string
	Group       string
	LastUpdated time.Time `bson:"last_updated"`
	HomeTeam    Team      `bson:"home_team"`
	AwayTeam    Team      `bson:"away_team"`
	Score       Score
	Odds        Odds
	Referees    []Referee
}

func (match *Match) HasStarted() bool {
	switch match.Status {
	case
		SCHEDULED,
		TIMED,
		POSTPONED,
		CANCELLED:
		return false
	case
		IN_PLAY,
		PAUSED,
		FINISHED,
		SUSPENDED,
		AWARDED:
		return true
	}
	return false
}

func (match *Match) IsHalftime() bool {
	return match.Status == PAUSED
}

func (match *Match) HasFinished() bool {
	return match.Status == FINISHED
}

func (match *Match) IsLive() bool {
	if match.Status == IN_PLAY || match.Status == PAUSED {
		return true
	}
	return false
}

func (match *Match) TeamPoints(teamName string) int {
	if match.HomeTeam.ShortName == teamName {
		if match.Score.FullTime.Home > match.Score.FullTime.Away {
			return 3
		} else if match.Score.FullTime.Home == match.Score.FullTime.Away {
			return 1
		}
	} else if match.AwayTeam.ShortName == teamName {
		if match.Score.FullTime.Away > match.Score.FullTime.Home {
			return 3
		} else if match.Score.FullTime.Away == match.Score.FullTime.Home {
			return 1
		}
	}

	return 0
}

type FormItem struct {
	Character string
	CssClass  string `bson:"css_class"`
}

type LiveTableItem struct {
	Position       int
	Team           Team
	PlayedGames    int `bson:"played_games"`
	Form           string
	Won            int
	Draw           int
	Lost           int
	Points         int
	GoalsFor       int        `bson:"goals_for"`
	GoalsAgainst   int        `bson:"goals_against"`
	GoalDifference int        `bson:"goal_difference"`
	HasStarted     bool       `bson:"has_started"`
	IsHalftime     bool       `bson:"is_halftime"`
	HasFinished    bool       `bson:"has_finished"`
	ScoreString    *string    `bson:"score_string"`
	CssClass       *string    `bson:"css_class"`
	FormList       []FormItem `bson:"form_list"`
}
