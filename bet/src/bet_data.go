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

// Create a new BetData struct
func NewBetData(thisTeamPointsData *TeamPointsData, otherTeamPointsDataA *TeamPointsData, otherTeamPointsDataB *TeamPointsData) *BetData {
	return &BetData{
		TeamName: strings.ToLower(thisTeamPointsData.teamName),
		Name:     thisTeamPointsData.playerName,
		Played:   thisTeamPointsData.matchesPlayed,
		Points:   thisTeamPointsData.currentPoints,
		OweA: func() string {
			if thisTeamPointsData.currentPoints < otherTeamPointsDataA.currentPoints {
				return "To " + otherTeamPointsDataA.playerName
			}
			return "From " + otherTeamPointsDataA.playerName
		}(),
		AmountA: (thisTeamPointsData.currentPoints - otherTeamPointsDataA.currentPoints) * 5,
		OweB: func() string {
			if thisTeamPointsData.currentPoints < otherTeamPointsDataB.currentPoints {
				return "To " + otherTeamPointsDataB.playerName
			}
			return "From " + otherTeamPointsDataB.playerName
		}(),
		AmountB:       (thisTeamPointsData.currentPoints - otherTeamPointsDataB.currentPoints) * 5,
		BestCase:      thisTeamPointsData.BestCase(otherTeamPointsDataA, otherTeamPointsDataB),
		WorstCase:     thisTeamPointsData.WorstCase(otherTeamPointsDataA, otherTeamPointsDataB),
		Balance:       thisTeamPointsData.playerName + "'s Balance",
		BalanceAmount: (thisTeamPointsData.currentPoints - otherTeamPointsDataA.currentPoints + thisTeamPointsData.currentPoints - otherTeamPointsDataB.currentPoints) * 5,
		Live:          thisTeamPointsData.matchInPlay,
		HomeTeam:      thisTeamPointsData.inPlayHomeTeam,
		AwayTeam:      thisTeamPointsData.inPlayAwayTeam,
		HomeTeamScore: thisTeamPointsData.inPlayHomeTeamScore,
		AwayTeamScore: thisTeamPointsData.inPlayAwayTeamScore,
	}
}

// BetResponse holds the response structure for bets
type BetResponse struct {
	Bets []*BetData `json:"bets"`
}

type teamPointsDataResponse struct {
	teamPointsData *TeamPointsData
	err            error
}

// Function to construct the BetResponse
func NewBetResponse(db *Database) (*BetResponse, error) {
	// Create a channel to receive TeamPointsData
	liverpoolTeamPointsDataChan := make(chan teamPointsDataResponse)
	chelseaTeamPointsDataChan := make(chan teamPointsDataResponse)
	tottenhamTeamPointsDataChan := make(chan teamPointsDataResponse)

	// Fetch TeamPointsData for Liverpool
	go func() {
		teamPointsData, err := NewTeamPointsData(db, "Liverpool", "Steve", []string{"Chelsea", "Tottenham"})
		liverpoolTeamPointsDataChan <- teamPointsDataResponse{teamPointsData, err}
	}()

	// Fetch TeamPointsData for Chelsea
	go func() {
		teamPointsData, err := NewTeamPointsData(db, "Chelsea", "Tim", []string{"Liverpool", "Tottenham"})
		chelseaTeamPointsDataChan <- teamPointsDataResponse{teamPointsData, err}
	}()

	// Fetch TeamPointsData for Tottenham
	go func() {
		teamPointsData, err := NewTeamPointsData(db, "Tottenham", "Thommo", []string{"Liverpool", "Chelsea"})
		tottenhamTeamPointsDataChan <- teamPointsDataResponse{teamPointsData, err}
	}()

	// Wait for all goroutines to finish
	liverpoolTeamPointsData := <-liverpoolTeamPointsDataChan
	chelseaTeamPointsData := <-chelseaTeamPointsDataChan
	tottenhamTeamPointsData := <-tottenhamTeamPointsDataChan

	// Check for errors
	if liverpoolTeamPointsData.err != nil {
		return nil, liverpoolTeamPointsData.err
	}
	if chelseaTeamPointsData.err != nil {
		return nil, chelseaTeamPointsData.err
	}
	if tottenhamTeamPointsData.err != nil {
		return nil, tottenhamTeamPointsData.err
	}

	// Create the BetResponse
	betResponse := BetResponse{
		Bets: []*BetData{
			NewBetData(liverpoolTeamPointsData.teamPointsData, chelseaTeamPointsData.teamPointsData, tottenhamTeamPointsData.teamPointsData),
			NewBetData(chelseaTeamPointsData.teamPointsData, liverpoolTeamPointsData.teamPointsData, tottenhamTeamPointsData.teamPointsData),
			NewBetData(tottenhamTeamPointsData.teamPointsData, liverpoolTeamPointsData.teamPointsData, chelseaTeamPointsData.teamPointsData),
		},
	}

	// Sort the list of bets by points
	slices.SortStableFunc(betResponse.Bets, func(a, b *BetData) int {
		return b.Points - a.Points
	})

	return &betResponse, nil
}
