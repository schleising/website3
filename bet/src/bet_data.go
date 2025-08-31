package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// BetData holds the information for a single bet
type BetData struct {
	TeamName      string  `json:"team_name"`
	Name          string  `json:"name"`
	Played        int     `json:"played"`
	Points        int     `json:"points"`
	OweA          string  `json:"owea"`
	AmountA       float64 `json:"amounta"`
	OweB          string  `json:"oweb"`
	AmountB       float64 `json:"amountb"`
	BestCase      float64 `json:"best_case"`
	WorstCase     float64 `json:"worst_case"`
	Balance       string  `json:"balance"`
	BalanceAmount float64 `json:"balance_amount"`
	Live          bool    `json:"live"`
	HomeTeam      *string `json:"home_team"`
	AwayTeam      *string `json:"away_team"`
	HomeTeamScore *int    `json:"home_team_score"`
	AwayTeamScore *int    `json:"away_team_score"`
}

// BetResponse holds the response structure for bets
type BetResponse struct {
	Bets []BetData `json:"bets"`
}

type betResult struct {
	Response BetResponse
	Err      error
}

// Function to construct the BetResponse
func GetBetResponse() (BetResponse, error) {
	var betDataChannel = make(chan betResult)

	go func() {
		// Read the contents of /app/html/response.json into a BetResponse struct
		var betResponse BetResponse
		file, err := os.Open("/app/html/response.json")
		if err != nil {
			betDataChannel <- betResult{Response: BetResponse{}, Err: fmt.Errorf("failed to open response.json: %w", err)}
			return
		}

		// Ensure the file is closed after reading
		defer file.Close()

		// Unmarshal the JSON data into the struct
		if err := json.NewDecoder(file).Decode(&betResponse); err != nil {
			betDataChannel <- betResult{Response: BetResponse{}, Err: fmt.Errorf("failed to decode JSON: %w", err)}
			return
		}

		betDataChannel <- betResult{Response: betResponse, Err: nil}
	}()

	var betResponse = <-betDataChannel

	if betResponse.Err != nil {
		return BetResponse{}, betResponse.Err
	}

	return betResponse.Response, nil
}
