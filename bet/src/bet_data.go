package main

import (
	"slices"
	"strings"
)

// BetData holds the information for a single bet
type BetData struct {
	TeamName      string `json:"team_name"`
	Name          string `json:"name"`
	Played        int    `json:"played"`
	Points        int    `json:"points"`
	OweA          string `json:"owea"`
	AmountA       int    `json:"amounta"`
	OweB          string `json:"oweb"`
	AmountB       int    `json:"amountb"`
	BestCase      int    `json:"best_case"`
	WorstCase     int    `json:"worst_case"`
	Balance       string `json:"balance"`
	BalanceAmount int    `json:"balance_amount"`
	Live          bool   `json:"live"`
	HomeTeam      string `json:"home_team"`
	AwayTeam      string `json:"away_team"`
	HomeTeamScore int    `json:"home_team_score"`
	AwayTeamScore int    `json:"away_team_score"`
}

// BetResponse holds the response structure for bets
type BetResponse struct {
	Bets []BetData `json:"bets"`
}

// Function to construct the BetResponse
func NewBetResponse(db *Database) (*BetResponse, error) {
	// Create TeamPointsData instances
	liverpool, err := NewTeamPointsData(db, "Liverpool", []string{"Chelsea", "Tottenham"})
	if err != nil {
		return nil, err
	}
	chelsea, err := NewTeamPointsData(db, "Chelsea", []string{"Liverpool", "Tottenham"})
	if err != nil {
		return nil, err
	}
	tottenham, err := NewTeamPointsData(db, "Tottenham", []string{"Liverpool", "Chelsea"})
	if err != nil {
		return nil, err
	}

	// Create the BetResponse
	betResponse := BetResponse{
		Bets: []BetData{
			{
				TeamName: strings.ToLower(liverpool.teamName),
				Name:     "Steve",
				Played:   liverpool.matchesPlayed,
				Points:   liverpool.currentPoints,
				OweA: func() string {
					if liverpool.currentPoints < chelsea.currentPoints {
						return "To Tim"
					}
					return "From Tim"
				}(),
				AmountA: (liverpool.currentPoints - chelsea.currentPoints) * 5,
				OweB: func() string {
					if liverpool.currentPoints < tottenham.currentPoints {
						return "To Thommo"
					}
					return "From Thommo"
				}(),
				AmountB:       (liverpool.currentPoints - tottenham.currentPoints) * 5,
				BestCase:      liverpool.BestCase(chelsea, tottenham),
				WorstCase:     liverpool.WorstCase(chelsea, tottenham),
				Balance:       "Steve's Balance",
				BalanceAmount: (liverpool.currentPoints - chelsea.currentPoints + liverpool.currentPoints - tottenham.currentPoints) * 5,
				Live:          liverpool.matchInPlay,
				HomeTeam:      liverpool.inPlayHomeTeam,
				AwayTeam:      liverpool.inPlayAwayTeam,
				HomeTeamScore: liverpool.inPlayHomeTeamScore,
				AwayTeamScore: liverpool.inPlayAwayTeamScore,
			},
			{
				TeamName: strings.ToLower(chelsea.teamName),
				Name:     "Tim",
				Played:   chelsea.matchesPlayed,
				Points:   chelsea.currentPoints,
				OweA: func() string {
					if chelsea.currentPoints < liverpool.currentPoints {
						return "To Steve"
					}
					return "From Steve"
				}(),
				AmountA: (chelsea.currentPoints - liverpool.currentPoints) * 5,
				OweB: func() string {
					if chelsea.currentPoints < tottenham.currentPoints {
						return "To Thommo"
					}
					return "From Thommo"
				}(),
				AmountB:       (chelsea.currentPoints - tottenham.currentPoints) * 5,
				BestCase:      chelsea.BestCase(liverpool, tottenham),
				WorstCase:     chelsea.WorstCase(liverpool, tottenham),
				Balance:       "Tim's Balance",
				BalanceAmount: (chelsea.currentPoints - liverpool.currentPoints + chelsea.currentPoints - tottenham.currentPoints) * 5,
				Live:          chelsea.matchInPlay,
				HomeTeam:      chelsea.inPlayHomeTeam,
				AwayTeam:      chelsea.inPlayAwayTeam,
				HomeTeamScore: chelsea.inPlayHomeTeamScore,
				AwayTeamScore: chelsea.inPlayAwayTeamScore,
			},
			{
				TeamName: strings.ToLower(tottenham.teamName),
				Name:     "Thommo",
				Played:   tottenham.matchesPlayed,
				Points:   tottenham.currentPoints,
				OweA: func() string {
					if tottenham.currentPoints < liverpool.currentPoints {
						return "To Steve"
					}
					return "From Steve"
				}(),
				AmountA: (tottenham.currentPoints - liverpool.currentPoints) * 5,
				OweB: func() string {
					if tottenham.currentPoints < chelsea.currentPoints {
						return "To Tim"
					}
					return "From Tim"
				}(),
				AmountB:       (tottenham.currentPoints - chelsea.currentPoints) * 5,
				BestCase:      tottenham.BestCase(liverpool, chelsea),
				WorstCase:     tottenham.WorstCase(liverpool, chelsea),
				Balance:       "Thommo's Balance",
				BalanceAmount: (tottenham.currentPoints - liverpool.currentPoints + tottenham.currentPoints - chelsea.currentPoints) * 5,
				Live:          tottenham.matchInPlay,
				HomeTeam:      tottenham.inPlayHomeTeam,
				AwayTeam:      tottenham.inPlayAwayTeam,
				HomeTeamScore: tottenham.inPlayHomeTeamScore,
				AwayTeamScore: tottenham.inPlayAwayTeamScore,
			},
		},
	}

	// Sort the list of bets by points
	slices.SortStableFunc(betResponse.Bets, func(a, b BetData) int {
		return b.Points - a.Points
	})

	return &betResponse, nil
}
