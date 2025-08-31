package main

import "strings"

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

type TableData struct {
	Table []LiveTableItem
	Err   error
}

type MatchData struct {
	Matches []Match
	Err     error
}

// Function to construct the BetResponse
func GetBetResponse(db *Database) (BetResponse, error) {
	// Create TeamPointsData instances
	liverpool := &TeamPointsData{}
	chelsea := &TeamPointsData{}
	tottenham := &TeamPointsData{}

	// Create a channel to receive the table data
	tableDataChannel := make(chan TableData)

	// Create channels to receive the head to head match data for Liverpool, Chelsea, and Tottenham
	liverpoolH2HChannel := make(chan MatchData)
	chelseaH2HChannel := make(chan MatchData)
	tottenhamH2HChannel := make(chan MatchData)

	// Create channels to receive the latest match data for Liverpool, Chelsea, and Tottenham
	liverpoolLatestChannel := make(chan MatchData)
	chelseaLatestChannel := make(chan MatchData)
	tottenhamLatestChannel := make(chan MatchData)

	// Get the table data
	go func() {
		// Fetch the table data from the database
		tableData, err := db.GetTableDb()
		tableDataChannel <- TableData{Table: tableData, Err: err}
	}()

	// Get the head to head match data for Liverpool
	go func() {
		// Fetch the head to head match data from the database
		matches, err := db.GetHeadToHeadMatchesDb("Chelsea", "Tottenham")
		liverpoolH2HChannel <- MatchData{Matches: matches, Err: err}
	}()

	// Get the head to head match data for Chelsea
	go func() {
		// Fetch the head to head match data from the database
		matches, err := db.GetHeadToHeadMatchesDb("Liverpool", "Tottenham")
		chelseaH2HChannel <- MatchData{Matches: matches, Err: err}
	}()

	// Get the head to head match data for Tottenham
	go func() {
		// Fetch the head to head match data from the database
		matches, err := db.GetHeadToHeadMatchesDb("Liverpool", "Chelsea")
		tottenhamH2HChannel <- MatchData{Matches: matches, Err: err}
	}()

	// Get the latest match data for Liverpool
	go func() {
		// Fetch the latest match data from the database
		match, err := db.GetLatestTeamMatchDb("Liverpool")
		liverpoolLatestChannel <- MatchData{Matches: []Match{*match}, Err: err}
	}()

	// Get the latest match data for Chelsea
	go func() {
		// Fetch the latest match data from the database
		match, err := db.GetLatestTeamMatchDb("Chelsea")
		chelseaLatestChannel <- MatchData{Matches: []Match{*match}, Err: err}
	}()

	// Get the latest match data for Tottenham
	go func() {
		// Fetch the latest match data from the database
		match, err := db.GetLatestTeamMatchDb("Tottenham")
		tottenhamLatestChannel <- MatchData{Matches: []Match{*match}, Err: err}
	}()

	// Wait for the data from the channels
	tableData := <-tableDataChannel
	liverpoolH2H := <-liverpoolH2HChannel
	chelseaH2H := <-chelseaH2HChannel
	tottenhamH2H := <-tottenhamH2HChannel
	liverpoolLatest := <-liverpoolLatestChannel
	chelseaLatest := <-chelseaLatestChannel
	tottenhamLatest := <-tottenhamLatestChannel

	// Check for errors
	if tableData.Err != nil {
		return BetResponse{}, tableData.Err
	}

	if liverpoolH2H.Err != nil {
		return BetResponse{}, liverpoolH2H.Err
	}

	if chelseaH2H.Err != nil {
		return BetResponse{}, chelseaH2H.Err
	}

	if tottenhamH2H.Err != nil {
		return BetResponse{}, tottenhamH2H.Err
	}

	if liverpoolLatest.Err != nil {
		return BetResponse{}, liverpoolLatest.Err
	}

	if chelseaLatest.Err != nil {
		return BetResponse{}, chelseaLatest.Err
	}

	if tottenhamLatest.Err != nil {
		return BetResponse{}, tottenhamLatest.Err
	}

	// Process the table data
	for _, item := range tableData.Table {
		switch item.Team.GetShortName() {
		case "Liverpool":
			liverpool.teamName = "Liverpool"
			liverpool.matchesPlayed = item.PlayedGames
			liverpool.currentPoints = item.Points
			liverpool.adjustedPoints = item.Points
			liverpool.remainingMatches = 38 - item.PlayedGames
		case "Chelsea":
			chelsea.teamName = "Chelsea"
			chelsea.matchesPlayed = item.PlayedGames
			chelsea.currentPoints = item.Points
			chelsea.adjustedPoints = item.Points
			chelsea.remainingMatches = 38 - item.PlayedGames
		case "Tottenham":
			tottenham.teamName = "Tottenham"
			tottenham.matchesPlayed = item.PlayedGames
			tottenham.currentPoints = item.Points
			tottenham.adjustedPoints = item.Points
			tottenham.remainingMatches = 38 - item.PlayedGames
		}
	}

	// Get the number of remaining head to head matches
	for _, match := range liverpoolH2H.Matches {
		if !match.HasFinished() {
			liverpool.remainingOtherH2HMatches += 1
		}
	}

	for _, match := range chelseaH2H.Matches {
		if !match.HasFinished() {
			chelsea.remainingOtherH2HMatches += 1
		}
	}

	for _, match := range tottenhamH2H.Matches {
		if !match.HasFinished() {
			tottenham.remainingOtherH2HMatches += 1
		}
	}

	// Adjust for in play matches
	liverpool = adjustInPlayMatches("Liverpool", liverpool, &liverpoolLatest.Matches[0])
	chelsea = adjustInPlayMatches("Chelsea", chelsea, &chelseaLatest.Matches[0])
	tottenham = adjustInPlayMatches("Tottenham", tottenham, &tottenhamLatest.Matches[0])

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

	return betResponse, nil
}

func adjustInPlayMatches(teamName string, teamPointData *TeamPointsData, teamLatestMatch *Match) *TeamPointsData {
	if teamLatestMatch.IsLive() {
		// Add one to the matches remaining
		teamPointData.remainingMatches += 1

		// Subtract the points for a live match
		teamPointData.adjustedPoints -= teamLatestMatch.TeamPoints(teamName)

		// Set the live flag
		teamPointData.matchInPlay = true

		// Store the in play match details
		teamPointData.inPlayHomeTeam = teamLatestMatch.HomeTeam.Tla
		teamPointData.inPlayAwayTeam = teamLatestMatch.AwayTeam.Tla
		teamPointData.inPlayHomeTeamScore = teamLatestMatch.Score.FullTime.Home
		teamPointData.inPlayAwayTeamScore = teamLatestMatch.Score.FullTime.Away
	}

	return teamPointData
}
