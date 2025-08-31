package main

import "time"

type Area struct {
	Id   int    `json:"id" bson:"id"`
	Name string `json:"name" bson:"name"`
	Code string `json:"code" bson:"code"`
	Flag string `json:"flag" bson:"flag"`
}

type Competition struct {
	Id     int    `json:"id" bson:"id"`
	Name   string `json:"name" bson:"name"`
	Code   string `json:"code" bson:"code"`
	Type   string `json:"type" bson:"type"`
	Emblem string `json:"emblem" bson:"emblem"`
}

type Team struct {
	Id        int    `json:"id" bson:"id"`
	Name      string `json:"name" bson:"name"`
	ShortName string `json:"short_name" bson:"short_name"`
	Tla       string `json:"tla" bson:"tla"`
	Crest     string `json:"crest" bson:"crest"`
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
	Id              int    `json:"id" bson:"id"`
	StartDate       string `json:"start_date" bson:"start_date"`
	EndDate         string `json:"end_date" bson:"end_date"`
	CurrentMatchday int    `json:"current_matchday" bson:"current_matchday"`
	Winner          Team   `json:"winner" bson:"winner"`
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
	Home int `json:"home" bson:"home"`
	Away int `json:"away" bson:"away"`
}

type HalfTime struct {
	Home int `json:"home" bson:"home"`
	Away int `json:"away" bson:"away"`
}

type Score struct {
	Winner   string   `json:"winner" bson:"winner"`
	Duration string   `json:"duration" bson:"duration"`
	FullTime FullTime `json:"full_time" bson:"full_time"`
	HalfTime HalfTime `json:"half_time" bson:"half_time"`
}

type Odds struct {
	Msg string `json:"msg" bson:"msg"`
}

type Referee struct {
	Id          int    `json:"id" bson:"id"`
	Name        string `json:"name" bson:"name"`
	Type        string `json:"type" bson:"type"`
	Nationality string `json:"nationality" bson:"nationality"`
}

type Match struct {
	Area        Area        `json:"area" bson:"area"`
	Competition Competition `json:"competition" bson:"competition"`
	Season      Season      `json:"season" bson:"season"`
	Id          int         `json:"id" bson:"id"`
	UtcDate     time.Time   `json:"utc_date" bson:"utc_date"`
	LocalDate   time.Time   `json:"local_date" bson:"local_date"`
	Status      MatchStatus `json:"status" bson:"status"`
	Minute      int         `json:"minute" bson:"minute"`
	InjuryTime  int         `json:"injury_time" bson:"injury_time"`
	Matchday    int         `json:"matchday" bson:"matchday"`
	Stage       string      `json:"stage" bson:"stage"`
	Group       string      `json:"group" bson:"group"`
	LastUpdated time.Time   `json:"last_updated" bson:"last_updated"`
	HomeTeam    Team        `json:"home_team" bson:"home_team"`
	AwayTeam    Team        `json:"away_team" bson:"away_team"`
	Score       Score       `json:"score" bson:"score"`
	Odds        Odds        `json:"odds" bson:"odds"`
	Referees    []Referee   `json:"referees" bson:"referees"`
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
	Character string `json:"character" bson:"character"`
	CssClass  string `json:"css_class" bson:"css_class"`
}

type LiveTableItem struct {
	Position       int        `json:"position" bson:"position"`
	Team           Team       `json:"team" bson:"team"`
	PlayedGames    int        `json:"played_games" bson:"played_games"`
	Form           string     `json:"form" bson:"form"`
	Won            int        `json:"won" bson:"won"`
	Draw           int        `json:"draw" bson:"draw"`
	Lost           int        `json:"lost" bson:"lost"`
	Points         int        `json:"points" bson:"points"`
	GoalsFor       int        `json:"goals_for" bson:"goals_for"`
	GoalsAgainst   int        `json:"goals_against" bson:"goals_against"`
	GoalDifference int        `json:"goal_difference" bson:"goal_difference"`
	HasStarted     bool       `json:"has_started" bson:"has_started"`
	IsHalftime     bool       `json:"is_halftime" bson:"is_halftime"`
	HasFinished    bool       `json:"has_finished" bson:"has_finished"`
	ScoreString    *string    `json:"score_string" bson:"score_string"`
	CssClass       *string    `json:"css_class" bson:"css_class"`
	FormList       []FormItem `json:"form_list" bson:"form_list"`
}
